/**
 * Safe Optimistic Transaction Wrapper
 *
 * This ensures optimistic updates are properly rolled back on transaction failure.
 * DO NOT apply optimistic updates manually - use this wrapper instead.
 */

import { QueryClient } from '@tanstack/react-query'
import { invalidateAfterTx, type OptimisticUpdates } from './invalidation'

interface SafeOptimisticTxParams {
  queryClient: QueryClient
  owner: string
  chainId: number
  poolId?: string
  positionIds?: string[]
  optimisticUpdates: OptimisticUpdates
  txPromise: Promise<{ wait: () => Promise<{ blockNumber: bigint; status: number }> }>
  onSuccess?: () => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
}

/**
 * Safely execute a transaction with optimistic UI updates
 *
 * This function ensures:
 * 1. Optimistic updates only apply AFTER transaction is submitted (hash obtained)
 * 2. Automatic rollback if transaction fails or reverts
 * 3. Replacement with real data on success
 *
 * Usage:
 * ```typescript
 * const tx = writeContract({ ... })
 *
 * await safeOptimisticTx({
 *   queryClient,
 *   owner: userAddress,
 *   poolId: poolId,
 *   optimisticUpdates: {
 *     addPendingPosition: {
 *       positionId: `pending-${Date.now()}`,
 *       poolId: poolId,
 *       tickLower: -100,
 *       tickUpper: 100,
 *       isPending: true,
 *     },
 *   },
 *   txPromise: tx, // Pass the transaction promise
 * })
 * ```
 */
export async function safeOptimisticTx(params: SafeOptimisticTxParams): Promise<void> {
  const { queryClient, owner, chainId, poolId, positionIds, optimisticUpdates, txPromise, onSuccess, onError } = params

  try {
    // Step 1: Wait for transaction to be submitted (get tx hash)
    console.log('[SafeOptimisticTx] Waiting for transaction submission...')
    const tx = await txPromise
    console.log('[SafeOptimisticTx] Transaction submitted, applying optimistic updates')

    // Step 2: Apply optimistic updates ONLY after tx is submitted
    await invalidateAfterTx(queryClient, {
      owner,
      chainId,
      poolId,
      positionIds,
      optimisticUpdates,
      awaitSubgraphSync: false, // Don't wait, show optimistic immediately
    })

    // Step 3: Wait for transaction confirmation
    console.log('[SafeOptimisticTx] Waiting for transaction confirmation...')
    const receipt = await tx.wait()

    // Step 4: Check if transaction actually succeeded
    if (receipt.status === 0) {
      throw new Error('Transaction reverted on-chain')
    }

    console.log('[SafeOptimisticTx] Transaction confirmed, replacing optimistic with real data')

    // Step 5: Success - replace optimistic with real data from chain/subgraph
    await invalidateAfterTx(queryClient, {
      owner,
      chainId,
      poolId,
      positionIds,
      awaitSubgraphSync: true,
      blockNumber: receipt.blockNumber,
      reloadPositions: true, // This removes isPending/isRemoving and fetches real data
    })

    console.log('[SafeOptimisticTx] Success - optimistic updates replaced with real data')

    if (onSuccess) {
      await onSuccess()
    }

  } catch (error) {
    console.error('[SafeOptimisticTx] Transaction failed, rolling back optimistic updates:', error)

    // CRITICAL: Rollback optimistic state by forcing fresh fetch
    try {
      await invalidateAfterTx(queryClient, {
        owner,
        chainId,
        poolId,
        positionIds,
        reloadPositions: true, // Force refetch, clears all optimistic flags
      })
      console.log('[SafeOptimisticTx] Rollback complete')
    } catch (rollbackError) {
      console.error('[SafeOptimisticTx] Rollback failed:', rollbackError)
      // Last resort: invalidate everything to force UI refresh
      queryClient.invalidateQueries()
    }

    if (onError) {
      await onError(error as Error)
    }

    throw error
  }
}

/**
 * Manually rollback optimistic updates (use in edge cases only)
 *
 * Normally safeOptimisticTx handles rollback automatically,
 * but this is exposed for manual cleanup if needed.
 */
export async function rollbackOptimisticUpdates(
  queryClient: QueryClient,
  owner: string,
  chainId: number,
  poolId?: string,
  positionIds?: string[]
): Promise<void> {
  console.log('[RollbackOptimistic] Manually rolling back optimistic updates')

  await invalidateAfterTx(queryClient, {
    owner,
    chainId,
    poolId,
    positionIds,
    reloadPositions: true,
  })
}
