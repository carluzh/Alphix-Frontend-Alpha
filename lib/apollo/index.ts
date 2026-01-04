/**
 * Apollo Module Index
 *
 * Main entry point for the Apollo data layer.
 * Re-exports client, cache, hooks, queries, and mutations.
 */

// Client
export { apolloClient } from './client'

// Cache
export { setupSharedApolloCache, normalizeTokenAddressForCache } from './cache'

// Links
export {
  getRestLink,
  getErrorLink,
  getGraphqlHttpLink,
  getCustomGraphqlHttpLink,
  getPerformanceLink,
  sample,
} from './links'

// Hooks
export {
  useAllPrices,
  useUserPositions,
  usePoolState,
} from './hooks'

// Queries
export {
  GET_TOKEN_PRICES,
  GET_TOKEN,
  GET_POOL,
  GET_POOL_STATE,
  GET_POOL_METRICS,
  GET_POOL_PRICE_HISTORY,
  GET_POOL_TICKS,
  GET_USER_POSITIONS,
  GET_POSITION,
  GET_POSITION_FEES,
} from './queries'

// Mutations / Invalidation
export { invalidateAfterTx, type OptimisticUpdates } from './mutations'

// Schema fragments (for custom queries)
export {
  TOKEN_FIELDS,
  POOL_FIELDS,
  POOL_STATE_FIELDS,
  POSITION_FIELDS,
  POSITION_WITH_POOL_FIELDS,
  PRICE_HISTORY_FIELDS,
  FEE_ITEM_FIELDS,
} from './schema/fragments'

// Generated types and hooks (from graphql-codegen)
// Includes: useGetPoolStateQuery, useGetUserPositionsQuery, useGetTokenPricesQuery, etc.
// Types: Chain, Token, Pool, Position, PoolState, etc.
export * from './__generated__'
