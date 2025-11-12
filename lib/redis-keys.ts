/**
 * Centralized Redis cache key generation
 *
 * This module provides consistent key naming for all Redis cache operations.
 * All keys follow the pattern: `{resource}:{identifier}[:version]`
 */

/**
 * Pool-related cache keys
 */
export const poolKeys = {
  /**
   * Batch data for all pools
   * TTL: 5min fresh, 15min stale
   */
  batch: (version: string = 'v1') => `pools-batch:${version}`,

  /**
   * Pool chart data (volume/TVL over time)
   * TTL: 1h
   */
  chart: (poolId: string, days: number) => `pool:chart:${poolId.toLowerCase()}:${days}d`,

  /**
   * @deprecated Individual pool stats - NOT USED, all data comes from pools-batch
   * Kept for backward compatibility only
   */
  stats: (poolId: string) => `pool:stats:${poolId.toLowerCase()}`,

  /**
   * @deprecated Individual pool state - NOT USED, all data comes from on-chain calls
   * Kept for backward compatibility only
   */
  state: (poolId: string) => `pool:state:${poolId.toLowerCase()}`,
} as const;

/**
 * Position fees cache keys (position data itself is NOT cached - use on-chain calls)
 */
export const positionKeys = {
  /**
   * Uncollected fees for a single position
   * TTL: 1min (updates frequently)
   */
  fees: (positionId: string) => `fees:${positionId}`,

  /**
   * Batch uncollected fees for multiple positions
   * TTL: 1min
   * Note: IDs are sorted for cache key consistency
   */
  feesBatch: (positionIds: string[]) => {
    const sorted = [...positionIds].sort();
    return `fees:batch:${sorted.join(',')}`;
  },
} as const;

/**
 * @deprecated User activity cache keys - Activity feed no longer displayed in UI
 * Kept for backward compatibility only
 */
export const activityKeys = {
  /**
   * @deprecated Portfolio activity for a user - NOT USED
   */
  byOwner: (address: string, first: number = 50) =>
    `activity:${address.toLowerCase()}:${first}`,
} as const;

/**
 * Price-related cache keys
 */
export const priceKeys = {
  /**
   * All token prices (batch)
   * TTL: 5min
   */
  batch: () => `prices:all`,

  /**
   * Individual token price
   * TTL: 5min
   */
  token: (symbol: string) => `price:${symbol.toUpperCase()}`,
} as const;

/**
 * Helper to get all cache keys for a specific user
 * Used for bulk invalidation after transactions
 *
 * Note: Currently returns empty array as:
 * - Activity feed is no longer displayed (deprecated)
 * - Position data is NOT cached (use on-chain calls)
 * - Position fees are invalidated separately since we need position IDs
 */
export function getUserCacheKeys(address: string): string[] {
  // Activity feed removed from UI - no user-specific cache keys to invalidate
  return [];
}

/**
 * Helper to get all pool-related cache keys
 * Used for bulk invalidation after pool-affecting transactions
 *
 * Note: Only invalidates pools-batch as:
 * - Individual pool:stats and pool:state are deprecated (not read by any endpoint)
 * - All pool data comes from pools-batch cache
 * - Charts have 1h TTL and use stale-while-revalidate (acceptable staleness)
 */
export function getPoolCacheKeys(poolId?: string): string[] {
  // Always invalidate pools-batch regardless of specific pool
  // This ensures all pool data refreshes on next request
  return [poolKeys.batch()];
}

/**
 * Pattern matchers for bulk operations
 * Use these with Redis SCAN command for finding keys
 */
export const patterns = {
  allPools: 'pool:*',
  allFees: 'fees:*',
  allActivity: 'activity:*',
  allPrices: 'price*',
} as const;
