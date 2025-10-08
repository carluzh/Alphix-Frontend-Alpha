/**
 * Centralized React Query key factory
 * All query keys follow a consistent pattern: [domain, resource, ...identifiers]
 */

export const queryKeys = {
  // Pool queries
  pools: {
    all: ['pools'] as const,
    list: () => [...queryKeys.pools.all, 'list'] as const,
    batch: (version?: string) =>
      version
        ? [...queryKeys.pools.all, 'batch', version] as const
        : [...queryKeys.pools.all, 'batch'] as const,
    detail: (poolId: string) => [...queryKeys.pools.all, 'detail', poolId] as const,
    stats: (poolId: string) => [...queryKeys.pools.all, 'stats', poolId] as const,
    state: (poolId: string) => [...queryKeys.pools.all, 'state', poolId] as const,
    chart: (poolId: string, days?: number) =>
      days
        ? [...queryKeys.pools.all, 'chart', poolId, days] as const
        : [...queryKeys.pools.all, 'chart', poolId] as const,
    fee: (poolId: string) => [...queryKeys.pools.all, 'fee', poolId] as const,
    feeHistory: (poolId: string, days?: number) =>
      days
        ? [...queryKeys.pools.all, 'feeHistory', poolId, days] as const
        : [...queryKeys.pools.all, 'feeHistory', poolId] as const,
  },

  // User queries
  user: {
    all: (address: string) => ['user', address.toLowerCase()] as const,
    positions: (address: string) =>
      [...queryKeys.user.all(address), 'positions'] as const,
    positionIds: (address: string) =>
      [...queryKeys.user.all(address), 'positionIds'] as const,
    position: (address: string, positionId: string) =>
      [...queryKeys.user.all(address), 'position', positionId] as const,
    fees: (address: string, positionId: string) =>
      [...queryKeys.user.all(address), 'fees', positionId] as const,
    feesBatch: (address: string, positionIds: string[]) =>
      [...queryKeys.user.all(address), 'feesBatch', positionIds.sort().join(',')] as const,
    activity: (address: string, limit?: number) =>
      limit
        ? [...queryKeys.user.all(address), 'activity', limit] as const
        : [...queryKeys.user.all(address), 'activity'] as const,
  },

  // Price queries
  prices: {
    all: ['prices'] as const,
    token: (symbol: string) => [...queryKeys.prices.all, 'token', symbol] as const,
    batch: (symbols: string[]) =>
      [...queryKeys.prices.all, 'batch', symbols.sort().join(',')] as const,
  },

  // Swap queries
  swap: {
    all: ['swap'] as const,
    quote: (fromSymbol: string, toSymbol: string, amount: string) =>
      [...queryKeys.swap.all, 'quote', fromSymbol, toSymbol, amount] as const,
    route: (fromSymbol: string, toSymbol: string) =>
      [...queryKeys.swap.all, 'route', fromSymbol, toSymbol] as const,
  },
} as const

/**
 * Type-safe query key helpers
 */
export type QueryKey =
  | ReturnType<typeof queryKeys.pools.list>
  | ReturnType<typeof queryKeys.pools.batch>
  | ReturnType<typeof queryKeys.pools.detail>
  | ReturnType<typeof queryKeys.pools.stats>
  | ReturnType<typeof queryKeys.pools.state>
  | ReturnType<typeof queryKeys.pools.chart>
  | ReturnType<typeof queryKeys.pools.fee>
  | ReturnType<typeof queryKeys.pools.feeHistory>
  | ReturnType<typeof queryKeys.user.all>
  | ReturnType<typeof queryKeys.user.positions>
  | ReturnType<typeof queryKeys.user.positionIds>
  | ReturnType<typeof queryKeys.user.position>
  | ReturnType<typeof queryKeys.user.fees>
  | ReturnType<typeof queryKeys.user.feesBatch>
  | ReturnType<typeof queryKeys.user.activity>
  | ReturnType<typeof queryKeys.prices.token>
  | ReturnType<typeof queryKeys.prices.batch>
  | ReturnType<typeof queryKeys.swap.quote>
  | ReturnType<typeof queryKeys.swap.route>
