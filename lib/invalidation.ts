/**
 * Cache Invalidation Re-export
 *
 * This file re-exports Apollo cache invalidation for backward compatibility.
 * The actual implementation is in lib/apollo/mutations/invalidation.ts
 *
 * @deprecated Import directly from '@/lib/apollo/mutations' in new code
 */

export { invalidateAfterTx, type OptimisticUpdates } from '@/lib/apollo/mutations'
