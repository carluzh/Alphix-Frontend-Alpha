export const runtime = 'nodejs';
export const preferredRegion = 'auto';

import { NextResponse } from 'next/server';
import { getCachedDataWithStale, setCachedData } from '@/lib/redis';
import { positionKeys } from '@/lib/redis-keys';

/**
 * Batch Uncollected Fees API
 *
 * Returns uncollected fees for multiple positions in a single request
 * Uses Redis cache with stale-while-revalidate pattern
 *
 * Cache Strategy:
 * - Fresh: 1 minute (fees update frequently)
 * - Stale: 5 minutes (acceptable for background refresh)
 * - Invalidated: After user transactions (via /api/cache/invalidate)
 *
 * POST Body:
 * - positionIds: string[] (required) - Array of position IDs
 *
 * Returns:
 * - Array of fee objects with amount0, amount1, tokens, and formatted amounts
 * - isStale flag (true if returning cached data while refetching)
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { positionIds } = body;

    if (!Array.isArray(positionIds) || positionIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'positionIds array is required' },
        { status: 400 }
      );
    }

    const cacheKey = positionKeys.feesBatch(positionIds);

    // Check Redis cache with staleness
    const { data: cachedData, isStale, isInvalidated } = await getCachedDataWithStale<any>(
      cacheKey,
      60,       // 1 minute fresh
      5 * 60    // 5 minutes stale window
    );

    // Fresh cache: return immediately
    if (cachedData && !isStale && !isInvalidated) {
      console.log('[Fees API] Redis cache HIT (fresh)');
      return NextResponse.json({
        success: true,
        items: cachedData,
        isStale: false,
      });
    }

    // Invalidated cache: blocking refetch (user just collected fees)
    if (cachedData && isInvalidated) {
      console.log('[Fees API] Redis cache INVALIDATED - performing blocking refresh');
      const fees = await fetchFeesFromExistingAPI(positionIds);

      // Cache for 1 minute
      await setCachedData(cacheKey, fees, 60);

      return NextResponse.json({
        success: true,
        items: fees,
        isStale: false,
      });
    }

    // Stale cache: return stale data, refresh in background
    if (cachedData && isStale) {
      console.log('[Fees API] Redis cache HIT (stale) - returning stale data, triggering background refresh');

      // Trigger background refresh (fire-and-forget)
      void fetchFeesFromExistingAPI(positionIds)
        .then((fees) => {
          return setCachedData(cacheKey, fees, 60);
        })
        .catch((error) => {
          console.error('[Fees API] Background refresh failed:', error);
        });

      return NextResponse.json({
        success: true,
        items: cachedData,
        isStale: true,
      });
    }

    // Cache miss: fetch fresh data
    console.log('[Fees API] Redis cache MISS - fetching fresh data');
    const fees = await fetchFeesFromExistingAPI(positionIds);

    // Cache for 1 minute
    await setCachedData(cacheKey, fees, 60);

    return NextResponse.json({
      success: true,
      items: fees,
      isStale: false,
    });
  } catch (error: any) {
    console.error('[Fees API] Error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Fetch fees from existing pages/api endpoint
 * This delegates to the proven implementation while adding Redis caching
 */
async function fetchFeesFromExistingAPI(positionIds: string[]): Promise<any[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/liquidity/get-uncollected-fees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionIds }),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      throw new Error(`Existing API returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.items)) {
      throw new Error('Invalid response format from existing API');
    }

    return data.items;
  } catch (error) {
    console.error('[Fees API] Failed to fetch from existing API:', error);
    throw error;
  }
}
