export const qk = {
  poolsList: ['pools', 'list'] as const,
  poolStats: (poolId: string) => ['pools', 'stats', String(poolId)] as const,
  poolChart: (poolId: string, days: number) => ['pools', 'chart', String(poolId), Number(days)] as const,
  dynamicFeeHistory: (poolId: string, days: number) => ['pools', 'feeHistory', String(poolId), Number(days)] as const,
  pricesAll: ['prices', 'all'] as const,
  userPositions: (ownerAddress: string) => ['user', 'positions', String(ownerAddress || '').toLowerCase()] as const,
  uncollectedFees: (positionId: string | number) => ['user', 'uncollectedFees', String(positionId)] as const,
  uncollectedFeesBatch: (idsKey: string) => ['user', 'uncollectedFeesBatch', String(idsKey)] as const,
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
  | typeof qk.poolState
  | typeof qk.dynamicFeeNow
  | typeof qk.quote
> | typeof qk.poolsList | typeof qk.pricesAll;
