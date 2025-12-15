import { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId, getStateViewAddress, getPoolById, getNetworkModeFromRequest } from '../../../lib/pools-config';
import { getSubgraphUrlForPool, isDaiPool, isMainnetSubgraphMode, getUniswapV4SubgraphUrl } from '../../../lib/subgraph-url-helper';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/redis-keys';
import { createNetworkClient } from '../../../lib/viemClient';
import { parseAbi, type Hex } from 'viem';

// Server-only subgraph URL (original, unswizzled) - for pool data (testnet only)
const SUBGRAPH_ORIGINAL_URL = process.env.SUBGRAPH_ORIGINAL_URL as string;

interface PoolDayData {
  date: number;
  volumeWFeeToken0: string;
  volumeWFeeToken1: string;
  volumeToken0: string;
  volumeToken1: string;
  tvlToken0: string;
  tvlToken1: string;
  currentFeeRateBps: string;
}

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

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);

  const { poolId, days = 7 } = req.body;

  if (!poolId) {
    return res.status(400).json({ error: 'poolId required' });
  }

  const apiId = getPoolSubgraphId(poolId, networkMode) || poolId;
  const isMainnet = isMainnetSubgraphMode(networkMode);
  const isDAI = isDaiPool(poolId, networkMode); // Only relevant for testnet
  const daysNum = Number(days) || 7;

  console.log('[pool-metrics] Request:', { poolId, apiId: apiId.toLowerCase(), days: daysNum, isDAI, isMainnet, networkMode });

  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;

  // Mainnet query: Uses Uniswap v4 subgraph schema
  const poolQueryMainnet = `
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

  // Testnet: Use different query based on whether it's a DAI pool (Satsuma schema) or not (Original schema)
  const poolQueryOriginal = `
    query PoolMetrics($poolId: Bytes!, $days: Int!) {
      trackedPool(id: $poolId) {
        id
        tvlToken0
        tvlToken1
        totalValueLockedToken0
        totalValueLockedToken1
        currentFeeRateBps
        txCount
      }

      poolDayDatas(
        where: { pool: $poolId }
        first: $days
        orderBy: date
        orderDirection: desc
      ) {
        date
        volumeWFeeToken0
        volumeWFeeToken1
        volumeToken0
        volumeToken1
        tvlToken0
        tvlToken1
        currentFeeRateBps
      }
    }
  `;

  // Satsuma schema (for DAI pools on testnet) - uses standard Uniswap V3 field names
  const poolQuerySatsuma = `
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

  // Select query based on network and pool type
  const poolQuery = isMainnet ? poolQueryMainnet : (isDAI ? poolQuerySatsuma : poolQueryOriginal);

  try {
    // Use CacheService for pool metrics with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.metrics(apiId, daysNum, networkMode),
      CACHE_TTL,
      async () => {
        // Determine the appropriate subgraph URL for this pool
        // Mainnet: Use Uniswap v4 subgraph for Pool/PoolDayData
        // Testnet: DAI pools use Satsuma, others use ORIGINAL
        let poolDataUrl: string;
        if (isMainnet) {
          poolDataUrl = getUniswapV4SubgraphUrl(networkMode);
        } else {
          const subgraphUrlForPool = getSubgraphUrlForPool(poolId, networkMode);
          poolDataUrl = isDAI ? subgraphUrlForPool : SUBGRAPH_ORIGINAL_URL;
        }

        if (!poolDataUrl) {
          console.error('[pool-metrics] No subgraph URL available');
          return EMPTY_METRICS;
        }

        const [poolResponse, feeResponse] = await Promise.all([
          fetch(poolDataUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: poolQuery,
              variables: { poolId: apiId.toLowerCase(), days: daysNum }
            })
          }),
          fetch(`${baseUrl}/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(poolId)}&network=${networkMode}`)
        ]);

        // Check response status first
        if (!poolResponse.ok) {
          console.error('[pool-metrics] Pool subgraph error:', poolResponse.status, poolResponse.statusText);
          return EMPTY_METRICS;
        }

        if (!feeResponse.ok) {
          console.error('[pool-metrics] Fee subgraph error:', feeResponse.status, feeResponse.statusText);
        }

        // Handle empty/malformed responses gracefully
        let poolResult: any;
        let feeResult: any;

        try {
          const poolText = await poolResponse.text();
          if (!poolText || poolText.trim() === '') {
            console.log('[pool-metrics] Empty pool response');
            poolResult = { data: { trackedPool: null, poolDayDatas: [] } };
          } else {
            poolResult = JSON.parse(poolText);
          }
        } catch (e) {
          console.error('[pool-metrics] Failed to parse pool response:', e);
          poolResult = { data: { trackedPool: null, poolDayDatas: [] } };
        }

        try {
          // Fee events come from unified endpoint, already in array format
          feeResult = await feeResponse.json();
        } catch (e) {
          console.error('[pool-metrics] Failed to parse fee response:', e);
          feeResult = [];
        }

        if (poolResult?.errors) {
          console.error('[pool-metrics] Pool query errors:', JSON.stringify(poolResult.errors, null, 2));
          return EMPTY_METRICS;
        }

        const { data } = poolResult;
        // Fee events already come as an array from the unified endpoint
        const feeEvents = Array.isArray(feeResult) ? feeResult : [];

        // Handle both schema types (mainnet uses same schema as DAI/Satsuma)
        const pool = (isMainnet || isDAI) ? data?.pool : data?.trackedPool;

        if (!data?.poolDayDatas || data.poolDayDatas.length === 0) {
          console.log('[pool-metrics] No poolDayDatas found for pool. Pool may not be in subgraph yet.');
          return { ...EMPTY_METRICS, pool: pool || null };
        }

        // Normalize day data to common format
        const dayDatas = data.poolDayDatas.map((day: any) => ({
          date: day.date,
          volumeToken0: day.volumeToken0,
          volumeToken1: day.volumeToken1,
          tvlToken0: day.tvlToken0 || '0',
          tvlToken1: day.tvlToken1 || '0',
          currentFeeRateBps: day.currentFeeRateBps || '0'
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
          console.log(`[pool-metrics] Fetched actual LP fee from StateView: ${actualFeeBps} bps`);
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

        // Calculate TVL (mainnet and DAI pools use totalValueLockedToken0 from pool entity)
        let avgTVLToken0: number;
        if ((isMainnet || isDAI) && pool?.totalValueLockedToken0) {
          avgTVLToken0 = parseFloat(pool.totalValueLockedToken0);
        } else {
          avgTVLToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.tvlToken0 || '0'), 0) / dayDatas.length;
        }

        const totalVolumeToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.volumeToken0 || '0'), 0);

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
      }
    );

    // Set cache headers (no-store to let Redis handle caching, not CDN)
    res.setHeader('Cache-Control', 'no-store');
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale');
    }

    return res.status(200).json(result.data);
  } catch (error) {
    console.error('Error fetching pool metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch pool metrics' });
  }
}
