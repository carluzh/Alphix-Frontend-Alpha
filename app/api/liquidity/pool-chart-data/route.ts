export const runtime = 'nodejs';
export const preferredRegion = 'iad1';

import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/ratelimit';
import { getPoolId, getPoolBySlugMultiChain } from '@/lib/pools-config';
import { parseNetworkMode, type NetworkMode } from '@/lib/network-mode';
import { setCachedData, getCachedDataWithStale } from '@/lib/cache/redis';
import { poolKeys } from '@/lib/cache/redis-keys';
import { fetchPoolHistory } from '@/lib/backend-client';
import { fetchFeeEvents as fetchFeeEventsShared, type HookEvent } from '@/lib/liquidity/fetchFeeEvents';

interface ChartDataPoint {
  date: string;
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

interface ChartDataResponse {
  success: boolean;
  poolId: string;
  data: ChartDataPoint[];
  feeEvents: HookEvent[];
  timestamp?: number;
  isStale?: boolean;
  message?: string;
}

/**
 * Map backend period to days
 */
function getPeriodForDays(days: number): 'DAY' | 'WEEK' | 'MONTH' {
  if (days <= 1) return 'DAY';
  if (days <= 7) return 'WEEK';
  return 'MONTH';
}

async function computeChartData(poolSlug: string, days: number, networkMode: NetworkMode): Promise<ChartDataResponse> {
  try {
    // Resolve slug to on-chain poolId hash
    let poolId = getPoolId(poolSlug, networkMode);
    let effectiveNetworkMode = networkMode;
    if (!poolId) {
      const multiChainPool = getPoolBySlugMultiChain(poolSlug);
      if (multiChainPool) {
        poolId = multiChainPool.poolId;
        effectiveNetworkMode = multiChainPool.networkMode;
      }
    }
    poolId = (poolId || poolSlug).toLowerCase();
    if (!/^0x[a-f0-9]+$/i.test(poolId)) throw new Error('Invalid pool ID format');

    // Fetch historical data from backend + fee events from backend in parallel
    const period = getPeriodForDays(days);
    const [historyResponse, feeEvents] = await Promise.all([
      fetchPoolHistory(poolId, period, effectiveNetworkMode),
      fetchFeeEventsShared(poolId, effectiveNetworkMode),
    ]);

    if (!historyResponse.success || !historyResponse.snapshots) {
      // No history snapshots — still return success if we have fee events
      if (feeEvents.length > 0) {
        return {
          success: true,
          poolId,
          data: [],
          feeEvents,
          timestamp: Date.now(),
        };
      }
      const errorMsg = historyResponse.error || 'Backend history fetch failed';
      console.error('[pool-chart-data] Backend history fetch failed:', errorMsg);
      return {
        success: false,
        message: errorMsg,
        poolId,
        data: [],
        feeEvents: [],
        timestamp: Date.now()
      };
    }

    // Group snapshots by date and aggregate — backend provides pre-computed USD values
    const dataByDate = new Map<string, { tvlUSD: number; volumeUSD: number; feesUSD: number; count: number }>();

    for (const snapshot of historyResponse.snapshots) {
      const date = new Date(snapshot.timestamp * 1000).toISOString().split('T')[0];

      const tvlUSD = snapshot.tvlUSD || 0;
      const volumeUSD = snapshot.volumeUSD || 0;
      const feesUSD = snapshot.feesUSD || 0;

      const existing = dataByDate.get(date);
      if (existing) {
        // Take latest TVL for the day, take max volume/fees (24h rolling values)
        existing.tvlUSD = tvlUSD;
        existing.volumeUSD = Math.max(existing.volumeUSD, volumeUSD);
        existing.feesUSD = Math.max(existing.feesUSD, feesUSD);
        existing.count++;
      } else {
        dataByDate.set(date, { tvlUSD, volumeUSD, feesUSD, count: 1 });
      }
    }

    // Generate date keys for the past N days
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

    // Build final chart data with forward-fill for missing TVL
    const data: ChartDataPoint[] = [];
    let lastTvlUSD = 0;

    for (const dateKey of allDateKeys) {
      const dayData = dataByDate.get(dateKey);

      if (dayData) {
        lastTvlUSD = dayData.tvlUSD;
        data.push({
          date: dateKey,
          tvlUSD: dayData.tvlUSD,
          volumeUSD: dayData.volumeUSD,
          feesUSD: dayData.feesUSD,
        });
      } else {
        data.push({
          date: dateKey,
          tvlUSD: lastTvlUSD, // Forward-fill
          volumeUSD: 0,
          feesUSD: 0,
        });
      }
    }

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

/** Don't cache thin results — they indicate a transient backend issue */
function isCacheWorthy(p: ChartDataResponse): boolean {
  return p.data.length >= 2 || p.feeEvents.length >= 3;
}

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const requestUrl = new URL(request.url);
    const searchParams = requestUrl.searchParams;
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

    // Read network from query param, default to base
    const networkParam = searchParams.get('network');
    const networkMode = parseNetworkMode(networkParam);

    // Use poolKeys helper for consistent cache key naming (include network mode)
    const cacheKey = poolKeys.chart(poolId, days, networkMode);

    // Check Redis cache with staleness
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<ChartDataResponse>(
      cacheKey,
      5 * 60,   // 5 minutes fresh
      60 * 60   // 1 hour stale window
    );

    // Fresh cache: return immediately
    if (cachedData && !isStale && !isInvalidated) {
      return NextResponse.json(cachedData);
    }

    // Invalidated cache: blocking fetch (user just did an action)
    if (cachedData && isInvalidated) {
      const payload = await computeChartData(poolId, days, networkMode);
      // Only cache responses with meaningful data — thin results re-fetch next time
      if (payload.success && isCacheWorthy(payload)) {
        await setCachedData(cacheKey, payload, 3600); // 1 hour TTL
      }
      return NextResponse.json({ ...payload, isStale: false });
    }

    // Stale cache (not invalidated): return immediately, refresh in background
    if (cachedData && isStale) {
      // Trigger background revalidation (fire-and-forget)
      void computeChartData(poolId, days, networkMode)
        .then((payload) => {
          if (payload.success && isCacheWorthy(payload)) {
            return setCachedData(cacheKey, payload, 3600);
          }
        })
        .catch((error) => {
          console.error('[pool-chart-data] Background revalidation failed:', error);
        });

      // Return stale data with flag
      return NextResponse.json({ ...cachedData, isStale: true });
    }

    // Cache miss: fetch fresh data
    const payload = await computeChartData(poolId, days, networkMode);

    // Only cache responses with meaningful data — thin results re-fetch next time
    if (payload.success && isCacheWorthy(payload)) {
      await setCachedData(cacheKey, payload, 3600); // 1 hour
    }

    return NextResponse.json(payload);

  } catch (error: any) {
    console.error('[pool-chart-data] Unexpected error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
