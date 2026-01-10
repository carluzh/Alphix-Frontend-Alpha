/**
 * Top-level cache keys for React Query to ensure unique keys.
 * Mirrors Uniswap's ReactQueryCacheKey pattern from:
 * interface/packages/utilities/src/reactQuery/cache.ts
 */
export enum AlphixCacheKey {
  // Chart data
  OverviewChart = 'overview-chart',
  PositionsChart = 'positions-chart',

  // Price data
  QuotePrice = 'quote-price',

  // Pool data
  PoolChartData = 'pool-chart-data',
}

/**
 * Queries that should NOT be persisted to localStorage.
 *
 * Reasons to exclude:
 * - Contains non-serializable data (React components, functions)
 * - Contains sensitive/session-specific data
 * - Data is highly time-sensitive (stale immediately)
 *
 * Note: Queries with gcTime === 0 are automatically excluded
 * (e.g., approval checks, permit2 allowance)
 */
export const DISABLE_CACHE_PERSISTENCE: AlphixCacheKey[] = [
  // Currently no exclusions needed - all query types are safe to persist
  // Add keys here if needed in the future
]
