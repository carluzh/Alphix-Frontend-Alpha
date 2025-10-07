/**
 * Transaction mutation hooks
 * Provides type-safe mutations with automatic cache invalidation
 */

import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useInvalidationOrchestrator } from '../coordination/invalidation-orchestrator'
import { setIndexingBarrier, waitForBarrier } from '../coordination/barriers'
import type { TransactionContext } from '../types'

export interface AddLiquidityParams {
  poolId: string
  owner: string
  amount0: string
  amount1: string
  tickLower: number
  tickUpper: number
}

export interface RemoveLiquidityParams {
  poolId: string
  owner: string
  positionId: string
  liquidity: string
}

export interface CollectFeesParams {
  poolId: string
  owner: string
  positionId: string
}

export interface TransactionReceipt {
  hash: string
  blockNumber: number
  status: 'success' | 'reverted'
}

/**
 * Hook for add liquidity mutation with automatic cache invalidation
 */
export function useAddLiquidityMutation(options?: {
  onSuccess?: (receipt: TransactionReceipt, params: AddLiquidityParams) => void
  onError?: (error: Error, params: AddLiquidityParams) => void
}): UseMutationResult<TransactionReceipt, Error, AddLiquidityParams> {
  const orchestrator = useInvalidationOrchestrator()

  return useMutation({
    mutationFn: async (params: AddLiquidityParams) => {
      // This would be replaced with actual transaction execution
      // For now, this is a placeholder that imports the real function
      const { executeAddLiquidity } = await import('@/components/liquidity/useIncreaseLiquidity')

      // Execute transaction (implementation delegated to existing code)
      const receipt = await executeAddLiquidity(params)

      // Set indexing barrier
      const barrier = setIndexingBarrier(params.owner, receipt.blockNumber)

      // Wait for subgraph to index
      const indexed = await barrier

      if (!indexed) {
        console.warn('[Mutation] Subgraph indexing timed out, proceeding anyway')
      }

      return receipt
    },

    onSuccess: async (receipt, params) => {
      // Invalidate caches
      await orchestrator.invalidateAfterTransaction({
        owner: params.owner,
        poolId: params.poolId,
        blockNumber: receipt.blockNumber,
        reason: 'add_liquidity',
      })

      // Call user's onSuccess if provided
      options?.onSuccess?.(receipt, params)
    },

    onError: (error, params) => {
      console.error('[Mutation] Add liquidity failed:', error)
      options?.onError?.(error, params)
    },
  })
}

/**
 * Hook for remove liquidity mutation with automatic cache invalidation
 */
export function useRemoveLiquidityMutation(options?: {
  onSuccess?: (receipt: TransactionReceipt, params: RemoveLiquidityParams) => void
  onError?: (error: Error, params: RemoveLiquidityParams) => void
}): UseMutationResult<TransactionReceipt, Error, RemoveLiquidityParams> {
  const orchestrator = useInvalidationOrchestrator()

  return useMutation({
    mutationFn: async (params: RemoveLiquidityParams) => {
      const { executeRemoveLiquidity } = await import('@/components/liquidity/useDecreaseLiquidity')

      const receipt = await executeRemoveLiquidity(params)

      // Set indexing barrier
      const barrier = setIndexingBarrier(params.owner, receipt.blockNumber)
      await barrier

      return receipt
    },

    onSuccess: async (receipt, params) => {
      await orchestrator.invalidateAfterTransaction({
        owner: params.owner,
        poolId: params.poolId,
        positionIds: [params.positionId],
        blockNumber: receipt.blockNumber,
        reason: 'remove_liquidity',
      })

      options?.onSuccess?.(receipt, params)
    },

    onError: (error, params) => {
      console.error('[Mutation] Remove liquidity failed:', error)
      options?.onError?.(error, params)
    },
  })
}

/**
 * Hook for collect fees mutation with automatic cache invalidation
 */
export function useCollectFeesMutation(options?: {
  onSuccess?: (receipt: TransactionReceipt, params: CollectFeesParams) => void
  onError?: (error: Error, params: CollectFeesParams) => void
}): UseMutationResult<TransactionReceipt, Error, CollectFeesParams> {
  const orchestrator = useInvalidationOrchestrator()

  return useMutation({
    mutationFn: async (params: CollectFeesParams) => {
      const { executeCollectFees } = await import('@/components/liquidity/useDecreaseLiquidity')

      const receipt = await executeCollectFees(params)

      // Set indexing barrier
      const barrier = setIndexingBarrier(params.owner, receipt.blockNumber)
      await barrier

      return receipt
    },

    onSuccess: async (receipt, params) => {
      // Only invalidate fees, not entire position
      await orchestrator.invalidateAfterTransaction({
        owner: params.owner,
        poolId: params.poolId,
        positionIds: [params.positionId],
        blockNumber: receipt.blockNumber,
        reason: 'collect_fees',
      })

      options?.onSuccess?.(receipt, params)
    },

    onError: (error, params) => {
      console.error('[Mutation] Collect fees failed:', error)
      options?.onError?.(error, params)
    },
  })
}

/**
 * Generic transaction mutation that ensures barrier coordination
 * Use this for custom transactions not covered by the specific hooks above
 */
export function useTransactionMutation<TParams extends { owner: string; poolId?: string }>(
  executeFn: (params: TParams) => Promise<TransactionReceipt>,
  options?: {
    reason?: string
    onSuccess?: (receipt: TransactionReceipt, params: TParams) => void
    onError?: (error: Error, params: TParams) => void
  }
): UseMutationResult<TransactionReceipt, Error, TParams> {
  const orchestrator = useInvalidationOrchestrator()

  return useMutation({
    mutationFn: async (params: TParams) => {
      const receipt = await executeFn(params)

      // Set indexing barrier
      const barrier = setIndexingBarrier(params.owner, receipt.blockNumber)
      await barrier

      return receipt
    },

    onSuccess: async (receipt, params) => {
      await orchestrator.invalidateAfterTransaction({
        owner: params.owner,
        poolId: params.poolId,
        blockNumber: receipt.blockNumber,
        reason: options?.reason ?? 'transaction',
      })

      options?.onSuccess?.(receipt, params)
    },

    onError: (error, params) => {
      console.error('[Mutation] Transaction failed:', error)
      options?.onError?.(error, params)
    },
  })
}
