// Centralized React Query keys for the app's data layer
// Category 1: infrequent/static-ish
// Category 2: user-action invalidated
// Category 3: continuous/on-block

export const qk = {
  // Category 1
  poolsList: ['pools', 'list'] as const,
  poolStats: (poolId: string) => ['pools', 'stats', String(poolId)] as const,
  poolChart: (poolId: string, days: number) => ['pools', 'chart', String(poolId), Number(days)] as const,
  dynamicFeeHistory: (poolId: string, days: number) => ['pools', 'feeHistory', String(poolId), Number(days)] as const,
  pricesAll: ['prices', 'all'] as const,

  // Category 2
  userPositions: (ownerAddress: string) => ['user', 'positions', String(ownerAddress || '').toLowerCase()] as const,
  uncollectedFees: (positionId: string | number) => ['user', 'uncollectedFees', String(positionId)] as const,
  uncollectedFeesBatch: (idsKey: string) => ['user', 'uncollectedFeesBatch', String(idsKey)] as const,
  activity: (ownerAddress: string, first: number) => ['user', 'activity', String(ownerAddress || '').toLowerCase(), Number(first)] as const,

  // Category 3
  poolState: (poolId: string) => ['pools', 'state', String(poolId)] as const,
  dynamicFeeNow: (poolId: string) => ['pools', 'feeNow', String(poolId)] as const,
  quote: (fromSymbol: string, toSymbol: string, amount: string) => ['swap', 'quote', String(fromSymbol), String(toSymbol), String(amount)] as const,
} as const;

export type QueryKey = ReturnType<
  | typeof qk.poolStats
  | typeof qk.poolChart
  | typeof qk.dynamicFeeHistory
  | typeof qk.userPositions
  | typeof qk.uncollectedFees
  | typeof qk.uncollectedFeesBatch
  | typeof qk.activity
  | typeof qk.poolState
  | typeof qk.dynamicFeeNow
  | typeof qk.quote
> | typeof qk.poolsList | typeof qk.pricesAll;

export const QUERY_CATEGORY = {
  CATEGORY_1: 'CATEGORY_1', // infrequent/static-ish
  CATEGORY_2: 'CATEGORY_2', // user-action invalidated
  CATEGORY_3: 'CATEGORY_3', // continuous/on-block
} as const;

export type QueryCategory = typeof QUERY_CATEGORY[keyof typeof QUERY_CATEGORY];

export const categoryDefaults: Record<QueryCategory, { staleTimeMs: number; gcTimeMs: number }> = {
  CATEGORY_1: { staleTimeMs: 60 * 60 * 1000, gcTimeMs: 6 * 60 * 60 * 1000 }, // 1h stale, 6h GC (historical data)
  CATEGORY_2: { staleTimeMs: 24 * 60 * 60 * 1000, gcTimeMs: 48 * 60 * 60 * 1000 }, // 24h stale, 48h GC (user data)
  CATEGORY_3: { staleTimeMs: 0, gcTimeMs: 10 * 60 * 1000 }, // on-block invalidation
};



