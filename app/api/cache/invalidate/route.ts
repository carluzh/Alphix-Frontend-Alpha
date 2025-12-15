import { NextResponse } from 'next/server';
import { invalidateCachedData } from '@/lib/redis';
import { getPoolCacheKeysByNetwork, getPoolTicksCacheKeyByNetwork } from '@/lib/redis-keys';
import { getNetworkModeFromRequest } from '@/lib/pools-config';

/**
 * Cache Invalidation API
 *
 * Supports two modes:
 * 1. Single key invalidation: ?key=pools-batch:v1
 * 2. Bulk transaction invalidation: POST body { ownerAddress, reason, poolId, positionIds }
 *
 * Invalidation strategy:
 * - Swap: pools-batch (volume/APY changed)
 * - Mint/Burn/Decrease: pools-batch (TVL changed) + pool:ticks (liquidity distribution changed)
 * - Collect: pools-batch only (fees claimed, no liquidity change)
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const keyParam = searchParams.get('key');

    // Mode 1: Single key invalidation (backwards compatible)
    if (keyParam) {
      await invalidateCachedData(keyParam);

      return NextResponse.json({
        success: true,
        message: `Cache invalidated: ${keyParam}`,
        note: 'Data still cached but marked for immediate refresh on next request'
      });
    }

    // Mode 2: Bulk transaction cache invalidation
    const body = await request.json().catch(() => ({}));
    const { ownerAddress, reason, poolId, positionIds } = body;

    const cookieHeader = request.headers.get('cookie') || '';
    const networkMode = getNetworkModeFromRequest(cookieHeader);

    if (!ownerAddress && !poolId && (!positionIds || positionIds.length === 0)) {
      return NextResponse.json(
        { success: false, message: 'Either key, ownerAddress, poolId, or positionIds is required' },
        { status: 400 }
      );
    }

    const keysToInvalidate: string[] = [];

    // Invalidate pool caches based on transaction type
    // Normalize reason values (callers use various names for the same operations)
    const isSwap = reason === 'swap' || reason === 'swap_complete';
    const isMint = reason === 'mint' || reason === 'liquidity-added';
    const isDecrease = reason === 'decrease' || reason === 'liquidity-withdrawn';
    const isCollect = reason === 'collect' || reason === 'fees-collected';

    const isPoolAffecting = poolId || isSwap || isMint || isDecrease || isCollect;
    if (isPoolAffecting) {
      // Always invalidate pools-batch for any pool-affecting transaction
      keysToInvalidate.push(...getPoolCacheKeysByNetwork(poolId, networkMode));

      // For LP operations (not swap, not collect), also invalidate tick data
      const isLpOperation = isMint || isDecrease;
      if (isLpOperation && poolId) {
        keysToInvalidate.push(...getPoolTicksCacheKeyByNetwork(poolId, networkMode));
      }
    }

    // Note: Position fees not cached in Redis (user-specific, React Query handles client-side)

    // Remove duplicates
    const uniqueKeys = Array.from(new Set(keysToInvalidate));

    // Invalidate all keys in parallel
    await Promise.all(
      uniqueKeys
        .filter(key => !key.includes('*')) // Skip patterns for now
        .map(key => invalidateCachedData(key))
    );

    return NextResponse.json({
      success: true,
      invalidated: uniqueKeys.length,
      keys: uniqueKeys,
      reason: reason || 'manual',
      note: 'Caches marked for immediate refresh on next request'
    });
  } catch (error: any) {
    console.error('[Cache] Invalidation error:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
