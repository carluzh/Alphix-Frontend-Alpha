import { NextResponse } from 'next/server';
import { invalidateCachedData } from '@/lib/redis';
import { getUserCacheKeys, getPoolCacheKeys, poolKeys } from '@/lib/redis-keys';

/**
 * Cache Invalidation API
 *
 * Supports two modes:
 * 1. Single key invalidation: ?key=pools-batch:v1
 * 2. Bulk user invalidation: POST body { ownerAddress, reason, poolId, positionIds }
 *
 * Usage:
 * - After user transactions: POST with ownerAddress to invalidate all user data
 * - Manual cache clear: ?key=specific-key
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

    // Mode 2: Bulk user cache invalidation
    const body = await request.json().catch(() => ({}));
    const { ownerAddress, reason, poolId, positionIds } = body;

    if (!ownerAddress && !poolId && (!positionIds || positionIds.length === 0)) {
      return NextResponse.json(
        { success: false, message: 'Either key, ownerAddress, poolId, or positionIds is required' },
        { status: 400 }
      );
    }

    const keysToInvalidate: string[] = [];

    // Invalidate user-specific caches
    if (ownerAddress) {
      const userKeys = getUserCacheKeys(ownerAddress);
      keysToInvalidate.push(...userKeys);
    }

    // Invalidate pool caches (if pool-affecting transaction)
    if (poolId || reason === 'swap' || reason === 'mint' || reason === 'liquidity-added' || reason === 'decrease') {
      const poolCacheKeys = getPoolCacheKeys(poolId);
      keysToInvalidate.push(...poolCacheKeys);

      // Always invalidate pool batch for liquidity-affecting transactions
      keysToInvalidate.push(poolKeys.batch());
    }

    // Invalidate position fees if position IDs provided
    if (positionIds && Array.isArray(positionIds)) {
      for (const posId of positionIds) {
        keysToInvalidate.push(`fees:${posId}`);
      }
      // Also invalidate any batch fee caches (they're ephemeral, can just clear all)
      keysToInvalidate.push('fees:batch:*'); // Pattern for later SCAN-based deletion
    }

    // Remove duplicates
    const uniqueKeys = Array.from(new Set(keysToInvalidate));

    // Invalidate all keys in parallel
    await Promise.all(
      uniqueKeys
        .filter(key => !key.includes('*')) // Skip patterns for now
        .map(key => invalidateCachedData(key))
    );

    console.log(`[Cache] Invalidated ${uniqueKeys.length} keys for ${reason || 'manual invalidation'}`, {
      ownerAddress,
      poolId,
      positionIds,
      keys: uniqueKeys
    });

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
