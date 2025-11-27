export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';
import { getPoolSubgraphId, getAllPools } from '@/lib/pools-config';
import { getSubgraphUrlForPool } from '@/lib/subgraph-url-helper';
import { setCachedData, getCachedDataWithStale } from '@/lib/redis';
import { poolKeys } from '@/lib/redis-keys';
import { batchGetTokenPrices } from '@/lib/price-service';

interface ChartDataPoint {
  date: string;
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

interface DynamicFeeEvent {
  timestamp: string;
  newFeeBps?: string;
  currentRatio?: string;
  currentTargetRatio?: string;
  newTargetRatio?: string;
  oldTargetRatio?: string;
}

interface ChartDataResponse {
  success: boolean;
  poolId: string;
  data: ChartDataPoint[];
  feeEvents: DynamicFeeEvent[];
  timestamp?: number;
  isStale?: boolean;
}

async function computeChartData(poolId: string, days: number): Promise<ChartDataResponse> {
  try {
    const subgraphId = (getPoolSubgraphId(poolId) || poolId).toLowerCase();
    const subgraphUrl = getSubgraphUrlForPool(poolId);

    if (!subgraphUrl) {
      throw new Error('Subgraph URL not found for pool');
    }

    // Get pool config for token symbols
    const allPools = getAllPools();
    const poolCfg = allPools.find(p => (getPoolSubgraphId(p.id) || p.id).toLowerCase() === subgraphId);
    const sym0 = poolCfg?.currency0?.symbol || 'USDC';
    const sym1 = poolCfg?.currency1?.symbol || 'USDC';

    // Get token prices for USD conversion
    const prices = await batchGetTokenPrices([sym0, sym1]);
    const p0 = prices[sym0] || 1;
    const p1 = prices[sym1] || 1;

    // Generate date keys for the past N days (excluding today for historical, including today for current)
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);

    const allDateKeys: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      allDateKeys.push(cursor.toISOString().split('T')[0]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const cutoffTimestamp = Math.floor(start.getTime() / 1000);
    const todayKey = new Date().toISOString().split('T')[0];

    console.log(`[pool-chart-data] Fetching data for pool ${subgraphId}, days: ${days}, dates: ${allDateKeys.length}`);

    // STEP 1: Fetch volume from poolHourDatas (aggregated to daily)
    const hourlyQuery = `{
      poolHourDatas(
        where: { pool: "${subgraphId}", periodStartUnix_gte: ${cutoffTimestamp} }
        orderBy: periodStartUnix
        orderDirection: desc
        first: 1000
      ) {
        periodStartUnix
        volumeToken0
      }
    }`;

    // STEP 2: Build block number query for end-of-day timestamps (for TVL)
    const blockAliases = allDateKeys.filter(k => k !== todayKey).map((key) => {
      const alias = `b_${key.replace(/-/g, '_')}`;
      const ts = Math.floor(new Date(key + 'T23:59:59Z').getTime() / 1000);
      return `${alias}: transactions(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_lte: ${ts} }) { blockNumber }`;
    }).join('\n');
    const blocksQuery = blockAliases ? `query Blocks {\n${blockAliases}\n}` : null;

    // Fetch volume, blocks, and fee events in parallel
    const [hourlyResult, blocksResult, feeEventsResult] = await Promise.all([
      // Query 1: Hourly volume data
      fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: hourlyQuery })
      }),

      // Query 2: Block numbers for TVL historical queries
      blocksQuery ? fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: blocksQuery })
      }) : Promise.resolve(null),

      // Query 3: Fee events from unified endpoint
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(subgraphId)}`)
    ]);

    if (!hourlyResult.ok) {
      throw new Error(`hourly query failed: ${hourlyResult.status}`);
    }

    const hourlyJson = await hourlyResult.json();
    if (hourlyJson.errors) {
      throw new Error(`hourly query errors: ${JSON.stringify(hourlyJson.errors)}`);
    }

    // Process hourly volume data - aggregate by date
    const hourlyData = hourlyJson?.data?.poolHourDatas || [];
    const volByDate = new Map<string, number>();
    for (const h of hourlyData) {
      const date = new Date(h.periodStartUnix * 1000).toISOString().split('T')[0];
      const vol = (volByDate.get(date) || 0) + Number(h.volumeToken0 || 0);
      volByDate.set(date, vol);
    }

    // Process block numbers for TVL queries
    const aliasToBlock = new Map<string, number>();
    if (blocksResult) {
      const blocksJson = await blocksResult.json();
      if (!blocksJson.errors) {
        for (const key of allDateKeys) {
          if (key === todayKey) continue;
          const alias = `b_${key.replace(/-/g, '_')}`;
          const arr = blocksJson?.data?.[alias] || [];
          const block = Array.isArray(arr) && arr.length > 0 ? Number(arr[0]?.blockNumber) || 0 : 0;
          if (block > 0) {
            aliasToBlock.set(key, block);
          }
        }
      }
    }

    // STEP 3: Query pool TVL at each historical block
    let tvlByDate = new Map<string, { tvl0: number; tvl1: number }>();

    if (aliasToBlock.size > 0) {
      const poolAliases = Array.from(aliasToBlock.entries()).map(([key, block]) => {
        const alias = `p_${key.replace(/-/g, '_')}`;
        return `${alias}: pools(where: { id: "${subgraphId}" }, block: { number: ${block} }) { totalValueLockedToken0 totalValueLockedToken1 }`;
      }).join('\n');

      const poolsQuery = `query Pools {\n${poolAliases}\n}`;

      const poolsResult = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: poolsQuery })
      });

      if (poolsResult.ok) {
        const poolsJson = await poolsResult.json();
        if (!poolsJson.errors) {
          for (const key of aliasToBlock.keys()) {
            const alias = `p_${key.replace(/-/g, '_')}`;
            const arr = poolsJson?.data?.[alias] || [];
            if (Array.isArray(arr) && arr[0]) {
              tvlByDate.set(key, {
                tvl0: Number(arr[0]?.totalValueLockedToken0) || 0,
                tvl1: Number(arr[0]?.totalValueLockedToken1) || 0
              });
            }
          }
        }
      }
    }

    // Get current TVL for today
    const currentPoolQuery = `{ pools(where: { id: "${subgraphId}" }) { totalValueLockedToken0 totalValueLockedToken1 } }`;
    const currentResult = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: currentPoolQuery })
    });

    if (currentResult.ok) {
      const currentJson = await currentResult.json();
      const currentPool = currentJson?.data?.pools?.[0];
      if (currentPool) {
        tvlByDate.set(todayKey, {
          tvl0: Number(currentPool.totalValueLockedToken0) || 0,
          tvl1: Number(currentPool.totalValueLockedToken1) || 0
        });
      }
    }

    // Process fee events
    let feeEvents: DynamicFeeEvent[] = [];
    if (feeEventsResult.ok) {
      feeEvents = await feeEventsResult.json();
      if (!Array.isArray(feeEvents)) feeEvents = [];
    }

    // Build final chart data with forward-fill for missing TVL
    const data: ChartDataPoint[] = [];
    let lastTvlUSD = 0;

    for (const dateKey of allDateKeys) {
      // Volume: token0 amount * price
      const vol0 = volByDate.get(dateKey) || 0;
      const volumeUSD = vol0 * p0;

      // TVL: token amounts * prices, with forward-fill
      const tvlData = tvlByDate.get(dateKey);
      let tvlUSD: number;
      if (tvlData) {
        tvlUSD = (tvlData.tvl0 * p0) + (tvlData.tvl1 * p1);
        if (tvlUSD > 0) lastTvlUSD = tvlUSD;
      } else {
        tvlUSD = lastTvlUSD; // Forward-fill
      }

      data.push({
        date: dateKey,
        tvlUSD,
        volumeUSD,
        feesUSD: 0, // Fee calculation would need fee rate per day
      });
    }

    console.log(`[pool-chart-data] Success: ${data.length} data points, ${feeEvents.length} fee events`);

    return {
      success: true,
      poolId,
      data,
      feeEvents,
      timestamp: Date.now()
    };

  } catch (error: any) {
    console.error('[pool-chart-data] Error:', error);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const poolId = searchParams.get('poolId');
    const daysParam = searchParams.get('days');

    if (!poolId) {
      return NextResponse.json(
        { success: false, message: 'poolId parameter is required' },
        { status: 400 }
      );
    }

    const days = parseInt(daysParam || '60', 10);
    if (!Number.isFinite(days) || days <= 0 || days > 120) {
      return NextResponse.json(
        { success: false, message: 'days must be between 1 and 120' },
        { status: 400 }
      );
    }

    // Use poolKeys helper for consistent cache key naming
    const cacheKey = poolKeys.chart(poolId, days);

    // Check Redis cache with staleness
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<ChartDataResponse>(
      cacheKey,
      5 * 60,   // 5 minutes fresh
      60 * 60   // 1 hour stale window
    );

    // Fresh cache: return immediately
    if (cachedData && !isStale && !isInvalidated) {
      console.log('[pool-chart-data] Redis cache HIT (fresh)');
      return NextResponse.json(cachedData);
    }

    // Invalidated cache: blocking fetch (user just did an action)
    if (cachedData && isInvalidated) {
      console.log('[pool-chart-data] Redis cache INVALIDATED - performing blocking refresh');
      const payload = await computeChartData(poolId, days);
      await setCachedData(cacheKey, payload, 3600); // 1 hour TTL
      return NextResponse.json({ ...payload, isStale: false });
    }

    // Stale cache (not invalidated): return immediately, refresh in background
    if (cachedData && isStale) {
      console.log('[pool-chart-data] Redis cache HIT (stale) - returning stale data, triggering background refresh');

      // Trigger background revalidation (fire-and-forget)
      void computeChartData(poolId, days)
        .then((payload) => setCachedData(cacheKey, payload, 3600))
        .catch((error) => {
          console.error('[pool-chart-data] Background revalidation failed:', error);
        });

      // Return stale data with flag
      return NextResponse.json({ ...cachedData, isStale: true });
    }

    // Cache miss: fetch fresh data
    console.log('[pool-chart-data] Redis cache MISS, fetching fresh data');
    const payload = await computeChartData(poolId, days);

    // Cache the result
    console.log('[pool-chart-data] Caching data (1-hour TTL)');
    await setCachedData(cacheKey, payload, 3600); // 1 hour

    return NextResponse.json(payload);

  } catch (error: any) {
    console.error('[pool-chart-data] Unexpected error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
