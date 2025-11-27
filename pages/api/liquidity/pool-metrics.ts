import { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';
import { getSubgraphUrlForPool, isDaiPool } from '../../../lib/subgraph-url-helper';
import { cacheService } from '@/lib/cache/CacheService';
import { poolKeys } from '@/lib/redis-keys';

// Server-only subgraph URL (original, unswizzled) - for pool data
const SUBGRAPH_ORIGINAL_URL = process.env.SUBGRAPH_ORIGINAL_URL as string;
if (!SUBGRAPH_ORIGINAL_URL) {
  throw new Error('SUBGRAPH_ORIGINAL_URL env var is required');
}

// Default subgraph URL
const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || process.env.SUBGRAPH_URL as string;
if (!SUBGRAPH_URL) {
  throw new Error('SUBGRAPH_URL env var is required');
}

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

  const { poolId, days = 7 } = req.body;

  if (!poolId) {
    return res.status(400).json({ error: 'poolId required' });
  }

  const apiId = getPoolSubgraphId(poolId) || poolId;
  const isDAI = isDaiPool(poolId);
  const daysNum = Number(days) || 7;

  console.log('[pool-metrics] Request:', { poolId, apiId: apiId.toLowerCase(), days: daysNum, isDAI });

  // Use different query based on whether it's a DAI pool (Satsuma schema) or not (Original schema)
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

  // Satsuma schema (for DAI pools) - uses standard Uniswap V3 field names
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

  const poolQuery = isDAI ? poolQuerySatsuma : poolQueryOriginal;

  try {
    // Use CacheService for pool metrics with stale-while-revalidate
    const result = await cacheService.cachedApiCall(
      poolKeys.metrics(apiId, daysNum),
      CACHE_TTL,
      async () => {
        // Determine the appropriate subgraph URL for this pool
        const subgraphUrlForPool = getSubgraphUrlForPool(poolId);

        // For DAI pools, use pool-specific Satsuma subgraph for both pool data and fee events
        // For non-DAI pools, use ORIGINAL subgraph for pool data and Satsuma for fee events
        const poolDataUrl = isDAI ? subgraphUrlForPool : SUBGRAPH_ORIGINAL_URL;

        const [poolResponse, feeResponse] = await Promise.all([
          fetch(poolDataUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: poolQuery,
              variables: { poolId: apiId.toLowerCase(), days: daysNum }
            })
          }),
          // Use unified fee events endpoint instead of duplicate query
          fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(poolId)}`)
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

        // Handle both schema types
        const pool = isDAI ? data?.pool : data?.trackedPool;

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

        // Sort fee events by timestamp ascending for chronological processing
        const sortedFeeEvents = [...feeEvents].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

        // Calculate fees for each day using the appropriate fee rate
        let totalFeesToken0 = 0;
        const sortedDayDatas = [...dayDatas].sort((a, b) => a.date - b.date);

        for (const day of sortedDayDatas) {
          const dayEndTimestamp = day.date + 86400;
          let feeBps = 0;
          for (const event of sortedFeeEvents) {
            const eventTimestamp = Number(event.timestamp);
            if (eventTimestamp <= dayEndTimestamp) {
              feeBps = Number(event.newFeeBps || 0);
            } else {
              break;
            }
          }
          const volumeToken0 = parseFloat(day.volumeToken0 || '0');
          const feeRate = feeBps / 1_000_000;
          totalFeesToken0 += volumeToken0 * feeRate;
        }

        // Calculate TVL
        let avgTVLToken0: number;
        if (isDAI && pool?.totalValueLockedToken0) {
          avgTVLToken0 = parseFloat(pool.totalValueLockedToken0);
        } else {
          avgTVLToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.tvlToken0 || '0'), 0) / dayDatas.length;
        }

        const totalVolumeToken0 = dayDatas.reduce((sum, day) => sum + parseFloat(day.volumeToken0 || '0'), 0);
        const currentActualFeeBps = sortedFeeEvents.length > 0
          ? Number(sortedFeeEvents[sortedFeeEvents.length - 1].newFeeBps || 0)
          : 0;

        return {
          pool,
          metrics: {
            totalFeesToken0,
            avgTVLToken0,
            totalVolumeToken0,
            currentFeeBps: currentActualFeeBps,
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
