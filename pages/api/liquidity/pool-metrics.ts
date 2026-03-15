import { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getStateViewAddress, getPoolById } from '../../../lib/pools-config';
import { resolveNetworkMode } from '../../../lib/network-mode';
import { getAlphixSubgraphUrl } from '../../../lib/subgraph-url-helper';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/cache/redis-keys';
import { createNetworkClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';
import { fetchFeeEvents } from '@/lib/liquidity/fetchFeeEvents';

// Cache TTL configuration (in seconds)
const CACHE_TTL = { fresh: 300, stale: 3600 }; // 5min fresh, 1hr stale

// Empty metrics response for error cases
const EMPTY_METRICS = {
  pool: null,
  metrics: {
    totalFeesToken0: 0,
    avgTVLToken0: 0,
    totalVolumeToken0: 0,
    currentFeeBps: 0,
    days: 0
  },
  dayData: []
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { poolId, days = 7 } = req.body;
  const networkMode = resolveNetworkMode(req);

  if (!poolId) {
    return res.status(400).json({ error: 'poolId required' });
  }

  const apiId = getPoolSubgraphId(poolId, networkMode) || poolId;
  const daysNum = Number(days) || 7;

  // Unified query: Works for both base and arbitrum
  const poolQuery = `
    query PoolMetrics($poolId: ID!, $days: Int!) {
      pool(id: $poolId) {
        id
        totalValueLockedToken0
        totalValueLockedToken1
        feeTier
        txCount
      }

      poolDayDatas(
        where: { pool: $poolId }
        first: $days
        orderBy: date
        orderDirection: desc
      ) {
        date
        volumeToken0
        volumeToken1
        tvlUSD
      }
    }
  `;

  try {
    // Use CacheService for pool metrics with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.metrics(apiId, daysNum, networkMode),
      CACHE_TTL,
      async () => {
        // Use unified subgraph URL for both networks
        const poolDataUrl = getAlphixSubgraphUrl(networkMode);
        if (!poolDataUrl) {
          console.error('[pool-metrics] No subgraph URL available');
          return EMPTY_METRICS;
        }

        // Fetch pool data from subgraph and fee events in parallel
        const poolController = new AbortController();
        const poolTimeoutId = setTimeout(() => poolController.abort(), 10000);

        const [poolResult, feeResult] = await Promise.allSettled([
          fetch(poolDataUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: poolQuery,
              variables: { poolId: apiId.toLowerCase(), days: daysNum }
            }),
            signal: poolController.signal
          }),
          fetchFeeEvents(poolId, networkMode)
        ]);

        clearTimeout(poolTimeoutId);

        // Extract pool response - required
        const poolResponse = poolResult.status === 'fulfilled' ? poolResult.value : null;
        if (!poolResponse || !poolResponse.ok) {
          console.error('[pool-metrics] Pool subgraph error:', poolResponse?.status, poolResponse?.statusText);
          return EMPTY_METRICS;
        }

        // Extract fee events - optional
        const feeEvents = feeResult.status === 'fulfilled' ? feeResult.value : [];
        if (feeResult.status === 'rejected') {
          console.warn('[pool-metrics] Fee events fetch failed:', feeResult.reason);
        }

        // Handle empty/malformed pool response gracefully
        let poolData: any;
        try {
          const poolText = await poolResponse.text();
          if (!poolText || poolText.trim() === '') {
            poolData = { data: { pool: null, poolDayDatas: [] } };
          } else {
            poolData = JSON.parse(poolText);
          }
        } catch (e) {
          console.error('[pool-metrics] Failed to parse pool response:', e);
          poolData = { data: { pool: null, poolDayDatas: [] } };
        }

        if (poolData?.errors) {
          console.error('[pool-metrics] Pool query errors:', JSON.stringify(poolData.errors, null, 2));
          return EMPTY_METRICS;
        }

        const { data } = poolData;
        const pool = data?.pool;

        if (!data?.poolDayDatas || data.poolDayDatas.length === 0) {
          console.log('[pool-metrics] No poolDayDatas found for pool. Pool may not be in subgraph yet.');
          return { ...EMPTY_METRICS, pool: pool || null };
        }

        const dayDatas = data.poolDayDatas.map((day: any) => ({
          date: day.date,
          volumeToken0: day.volumeToken0,
          volumeToken1: day.volumeToken1,
          tvlUSD: day.tvlUSD || '0'
        }));

        if (dayDatas.length === 0) {
          return { ...EMPTY_METRICS, pool };
        }

        // Fetch actual LP fee from StateView (dynamic fee from slot0)
        let actualFeeBps = 0;
        try {
          const poolConfig = getPoolById(poolId, networkMode);
          const stateViewAddress = getStateViewAddress(networkMode);
          const poolIdHex = (poolConfig?.subgraphId || apiId) as Hex;
          const client = createNetworkClient(networkMode);

          const stateViewAbi = parseAbi([
            'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)'
          ]);

          const slot0Data = await client.readContract({
            address: stateViewAddress as `0x${string}`,
            abi: stateViewAbi,
            functionName: 'getSlot0',
            args: [poolIdHex]
          }) as readonly [bigint, number, number, number];

          const [, , , lpFeeMillionths] = slot0Data;
          // Convert millionths to bps: bps = (lpFee / 1_000_000) * 10_000
          actualFeeBps = Math.round((Number(lpFeeMillionths) / 1_000_000) * 10_000 * 100) / 100;
        } catch (error) {
          console.error('[pool-metrics] Failed to fetch LP fee from StateView:', error);
          // Fall back to fee events if available
          const sortedFeeEvents = [...feeEvents].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
          if (sortedFeeEvents.length > 0) {
            actualFeeBps = Number(sortedFeeEvents[sortedFeeEvents.length - 1].newFeeBps || 0);
          }
        }

        // Calculate fees using the actual LP fee rate
        let totalFeesToken0 = 0;
        const sortedDayDatas = [...dayDatas].sort((a, b) => a.date - b.date);
        const feeRate = actualFeeBps / 10_000; // Convert bps to decimal (e.g., 30 bps = 0.003)

        for (const day of sortedDayDatas) {
          const volumeToken0 = parseFloat(day.volumeToken0 || '0');
          totalFeesToken0 += volumeToken0 * feeRate;
        }

        // Get current TVL from pool entity
        const avgTVLToken0 = pool?.totalValueLockedToken0
          ? parseFloat(pool.totalValueLockedToken0)
          : 0;

        const totalVolumeToken0 = dayDatas.reduce((sum: number, day: { volumeToken0?: string }) => sum + parseFloat(day.volumeToken0 || '0'), 0);

        return {
          pool,
          metrics: {
            totalFeesToken0,
            avgTVLToken0,
            totalVolumeToken0,
            currentFeeBps: actualFeeBps,
            days: dayDatas.length
          },
          dayData: dayDatas
        };
      },
      // Only cache if we have actual data - prevents caching failed/empty responses
      { shouldCache: (data: any) => data?.pool !== null || data?.dayData?.length > 0 }
    );

    // Uniswap multi-layer caching pattern for dynamic data
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale');
    }

    return res.status(200).json(result.data);
  } catch (error) {
    console.error('Error fetching pool metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch pool metrics' });
  }
}
