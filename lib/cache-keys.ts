/**
 * Centralized cache key generation
 * All keys follow pattern: {resource}:{identifier}
 */

export const cacheKeys = {
  // Pool batch data (TVL, volume, fees for all pools)
  poolsBatch: () => 'pools:batch',

  // Individual pool metrics (for APR calculation)
  poolMetrics: (poolId: string) => `pool:metrics:${poolId.toLowerCase()}`,

  // Pool chart data
  poolChart: (poolId: string, days: number) => `pool:chart:${poolId.toLowerCase()}:${days}d`,

  // Token prices
  prices: () => 'prices:all',
} as const

// TTL constants (in seconds)
export const cacheTTL = {
  poolsBatch: { fresh: 300, max: 900 },      // 5min fresh, 15min max
  poolMetrics: { fresh: 3600, max: 7200 },   // 1h fresh, 2h max
  poolChart: { fresh: 3600, max: 7200 },     // 1h fresh, 2h max
  prices: { fresh: 300, max: 900 },          // 5min fresh, 15min max
} as const
