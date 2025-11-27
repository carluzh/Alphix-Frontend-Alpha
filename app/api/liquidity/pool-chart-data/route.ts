export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';
import { getPoolSubgraphId, getAllPools } from '@/lib/pools-config';
import { getSubgraphUrlForPool, isDaiPool } from '@/lib/subgraph-url-helper';
import { getCachedData, setCachedData, getCachedDataWithStale } from '@/lib/redis';
import { poolKeys } from '@/lib/redis-keys';

// Unified query: Get TVL + Volume + Fees from poolDayDatas
const GET_POOL_DAY_DATA = `
  query GetPoolDayData($pool: String!, $cutoffTimestamp: Int!) {
    poolDayDatas(
      first: 120
      where: { pool: $pool, date_gte: $cutoffTimestamp }
      orderBy: date
      orderDirection: desc
    ) {
      date
      tvlUSD
      volumeToken0
      volumeToken1
      volumeUSD
      feesUSD
    }
  }
`;

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

    // Calculate cutoff date (Unix timestamp in seconds, not days!)
    const nowSec = Math.floor(Date.now() / 1000);
    const dayStart = Math.floor(nowSec / 86400) * 86400;
    const cutoffTimestamp = dayStart - (days * 86400); // Unix timestamp (seconds)

    console.log(`[pool-chart-data] Fetching data for pool ${subgraphId}, days: ${days}, cutoff timestamp: ${cutoffTimestamp}`);

    // Fetch poolDayDatas from subgraph and fee events from unified endpoint in parallel
    const [dayDataResult, feeEventsResult] = await Promise.all([
      // Query 1: poolDayDatas (TVL + Volume + Fees)
      fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GET_POOL_DAY_DATA,
          variables: { pool: subgraphId, cutoffTimestamp }
        })
      }),

      // Query 2: Fee events from unified endpoint (consolidates duplicate queries)
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(poolId)}`)
    ]);

    if (!dayDataResult.ok) {
      throw new Error(`poolDayDatas query failed: ${dayDataResult.status} ${dayDataResult.statusText}`);
    }

    if (!feeEventsResult.ok) {
      throw new Error(`fee events query failed: ${feeEventsResult.status} ${feeEventsResult.statusText}`);
    }

    const [dayDataJson, feeEvents] = await Promise.all([
      dayDataResult.json(),
      feeEventsResult.json()
    ]);

    if (dayDataJson.errors) {
      throw new Error(`poolDayDatas errors: ${JSON.stringify(dayDataJson.errors)}`);
    }

    // Process poolDayDatas
    const rawDayData = Array.isArray(dayDataJson?.data?.poolDayDatas) ? dayDataJson.data.poolDayDatas : [];

    // Convert to ChartDataPoint format with proper date validation
    const data: ChartDataPoint[] = rawDayData
      .map((d: any) => {
        try {
          // Date is stored as Unix timestamp in SECONDS (not days!)
          const dateValue = Number(d.date);

          // Validate the date value
          if (!Number.isFinite(dateValue) || dateValue <= 0) {
            console.warn(`[pool-chart-data] Invalid date value: ${d.date}`);
            return null;
          }

          // The subgraph stores dates as Unix timestamps in SECONDS
          const dateObj = new Date(dateValue * 1000);

          // Validate the resulting date
          if (isNaN(dateObj.getTime())) {
            console.warn(`[pool-chart-data] Invalid date object from timestamp: ${dateValue}`);
            return null;
          }

          const dateStr = dateObj.toISOString().split('T')[0];

          return {
            date: dateStr,
            tvlUSD: Number(d.tvlUSD) || 0,
            volumeUSD: Number(d.volumeUSD) || 0,
            feesUSD: Number(d.feesUSD) || 0,
          };
        } catch (error) {
          console.error(`[pool-chart-data] Error processing date for entry:`, d, error);
          return null;
        }
      })
      .filter((d): d is ChartDataPoint => d !== null)
      .sort((a, b) => a.date.localeCompare(b.date)); // Sort ascending by date

    // Fee events are already normalized by get-historical-dynamic-fees endpoint
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
