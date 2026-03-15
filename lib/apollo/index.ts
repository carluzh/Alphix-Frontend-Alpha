/**
 * Apollo Module Index
 *
 * Main entry point for the Apollo data layer.
 * Re-exports client, cache, hooks, queries, and mutations.
 */

// Client
export { apolloClient } from './client'

// Cache
export { setupSharedApolloCache } from './cache'

// Links
export {
  getErrorLink,
  sample,
} from './links'

// Hooks
export {
  usePoolState,
} from './hooks'

// Mutations / Invalidation
export { invalidateAfterTx, type OptimisticUpdates } from './mutations'

// Generated types and hooks (from graphql-codegen)
// Includes: useGetPoolStateQuery, useGetUserPositionsQuery, etc.
// Types: Chain, Token, Pool, Position, PoolState, etc.
export * from './__generated__'
