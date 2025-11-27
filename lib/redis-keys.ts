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
   * @deprecated Individual pool state - NOT CACHED
   * Pool state (sqrtPriceX96, tick, liquidity) must always be fresh for accurate quotes.
   * Stale sqrtPriceX96 would cause swap transactions to fail.
   */
  state: (poolId: string) => `pool:state:${poolId.toLowerCase()}`,

  /**
   * Pool tick data (liquidityGross, liquidityNet per tick)
   * TTL: 5min fresh, 1hr stale
   */
  ticks: (poolId: string) => `pool:ticks:${poolId.toLowerCase()}`,

  /**
   * Pool metrics (APY calculations, TVL, volume)
   * TTL: 5min fresh, 1hr stale
   */
  metrics: (poolId: string, days: number) => `pool:metrics:${poolId.toLowerCase()}:${days}d`,
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
 * Helper to get pool-related cache keys for invalidation
 * Used for bulk invalidation after pool-affecting transactions
 *
 * Invalidates:
 * - pools-batch: All pool stats (TVL, volume, APY) - always
 * - pool:metrics: Pool APY/volume metrics for specific pool - when poolId provided
 * - pool:ticks: Tick data (liquidity distribution) - only for LP operations (separate function)
 *
 * Does NOT invalidate (acceptable staleness / auto-refresh):
 * - pool:state: 30s TTL, contains sqrtPriceX96/tick/liquidity only - auto-refreshes fast
 * - pool:chart: CoinGecko price data - not affected by our transactions
 * - dynamic-fees: Historical fee events - only changes on hook triggers
 */
export function getPoolCacheKeys(poolId?: string): string[] {
  const keys = [poolKeys.batch()];

  // If specific pool, also invalidate its metrics (all time ranges)
  if (poolId) {
    keys.push(poolKeys.metrics(poolId, 1));
    keys.push(poolKeys.metrics(poolId, 7));
    keys.push(poolKeys.metrics(poolId, 30));
    keys.push(poolKeys.metrics(poolId, 60));
  }

  return keys;
}

/**
 * Get tick cache key for a specific pool
 * Use this for LP operations (mint/burn) that change liquidity distribution
 */
export function getPoolTicksCacheKey(poolId: string): string {
  return poolKeys.ticks(poolId);
}

/**
 * Pattern matchers for bulk operations
 * Use these with Redis SCAN command for finding keys
 */
export const patterns = {
  allPools: 'pool:*',
  allPrices: 'price*',
} as const;
