/**
 * Cache System - Public API
 *
 * This is the main entry point for the new cache system.
 * Import everything you need from here.
 *
 * @example
 * ```tsx
 * // Query hooks
 * import { usePoolsBatch, useUserPositions } from '@/lib/cache'
 *
 * // Mutation hooks
 * import { useAddLiquidityMutation } from '@/lib/cache'
 *
 * // Query keys (for manual invalidation)
 * import { queryKeys } from '@/lib/cache'
 * ```
 */

// Client-side exports
export { queryClient, STALE_TIMES, GC_TIMES } from './client/query-client'
export { queryKeys } from './client/query-keys'
export {
  getFromLocalStorage,
  setToLocalStorage,
  removeFromLocalStorage,
  clearStorageVersion,
  getStorageInfo,
  storageKeys,
} from './client/persistence'

// Query hooks
export {
  usePoolsBatch,
  usePoolStats,
  usePoolState,
  usePoolChart,
  usePoolFee,
} from './client/queries/pools'

export {
  useUserPositionIds,
  useUserPositions,
  useUncollectedFees,
  useUncollectedFeesBatch,
  useUserActivity,
} from './client/queries/positions'

// Mutation hooks
export {
  useAddLiquidityMutation,
  useRemoveLiquidityMutation,
  useCollectFeesMutation,
  useTransactionMutation,
} from './client/mutations'

// Coordination
export {
  setIndexingBarrier,
  getIndexingBarrier,
  waitForBarrier,
  clearBarrier,
  clearAllBarriers,
  getBarrierState,
} from './coordination/barriers'

export {
  InvalidationOrchestrator,
  getInvalidationOrchestrator,
  useInvalidationOrchestrator,
} from './coordination/invalidation-orchestrator'

// Server-side exports
export {
  CACHE_TAGS,
  CACHE_CONFIG,
  createVersionedKey,
  createServerCache,
  validatePoolsData,
  isSubgraphDataFresh,
} from './server/cache-helpers'

// Types
export type {
  CacheStrategy,
  TransactionContext,
  CacheMetrics,
  CacheLayer,
  CacheReport,
} from './types'
