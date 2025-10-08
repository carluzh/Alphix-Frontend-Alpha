/**
 * Invalidation orchestrator
 * Single source of truth for cache invalidation across all layers
 */

import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../client/query-keys'
import type { TransactionContext } from '../types'

/**
 * Orchestrates cache invalidation across client and server layers
 */
export class InvalidationOrchestrator {
  constructor(private queryClient: QueryClient) {}

  /**
   * Invalidate caches after a transaction completes and is indexed
   */
  async invalidateAfterTransaction(context: TransactionContext): Promise<void> {
    const { owner, poolId, positionIds, reason } = context

    try {
      // Invalidate user-specific data
      await this.invalidateUserData(owner, positionIds)

      // Invalidate pool-specific data
      if (poolId) {
        await this.invalidatePoolData(poolId)
        await this.invalidateServerCache(context)
      }

      // Invalidate activity feed
      this.queryClient.invalidateQueries({
        queryKey: queryKeys.user.activity(owner),
      })

      console.log('[Invalidation] Cache invalidated', { owner, poolId, reason })
    } catch (error) {
      console.error('[Invalidation] Failed to invalidate cache:', error)
      // Don't throw - invalidation failures shouldn't break the app
    }
  }

  /**
   * Invalidate user-specific data (positions, fees)
   */
  private async invalidateUserData(
    owner: string,
    positionIds?: string[]
  ): Promise<void> {
    // Invalidate all user data
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.user.all(owner),
    })

    // Specifically invalidate position IDs to force refetch
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.user.positionIds(owner),
    })

    // Invalidate fees for specific positions if provided
    if (positionIds && positionIds.length > 0) {
      for (const positionId of positionIds) {
        await this.queryClient.invalidateQueries({
          queryKey: queryKeys.user.fees(owner, positionId),
        })
      }

      // Invalidate batch fees query
      await this.queryClient.invalidateQueries({
        queryKey: queryKeys.user.feesBatch(owner, positionIds),
      })
    }
  }

  /**
   * Invalidate pool-specific data (stats, state, charts)
   */
  private async invalidatePoolData(poolId: string): Promise<void> {
    // Invalidate pool stats
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.stats(poolId),
    })

    // Invalidate pool state (current tick, liquidity, etc.)
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.state(poolId),
    })

    // Invalidate dynamic fee
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.fee(poolId),
    })

    // Invalidate charts (TVL/volume changes after liquidity modification)
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.chart(poolId),
    })

    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.feeHistory(poolId),
    })
  }

  /**
   * Invalidate server-side cache by triggering revalidation
   */
  private async invalidateServerCache(context: TransactionContext): Promise<void> {
    try {
      const body: any = {}
      if (context.blockNumber) {
        body.targetBlock = context.blockNumber
      }

      const response = await fetch('/api/internal/revalidate-pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        console.warn('[Invalidation] Server cache revalidation failed:', response.status)
      } else {
        const data = await response.json()
        console.log('[Invalidation] Server cache revalidated', data)

        // Invalidate pools batch query after server updates
        await this.queryClient.invalidateQueries({
          queryKey: queryKeys.pools.batch(),
        })
      }
    } catch (error) {
      console.error('[Invalidation] Server cache revalidation error:', error)
    }
  }

  /**
   * Invalidate all pool data (use sparingly - for manual refresh)
   */
  async invalidateAllPools(): Promise<void> {
    await this.queryClient.invalidateQueries({
      queryKey: queryKeys.pools.all,
    })

    await this.invalidateServerCache({ owner: 'system', reason: 'manual_refresh' })
  }

  /**
   * Invalidate price data
   */
  async invalidatePrices(symbols?: string[]): Promise<void> {
    if (symbols && symbols.length > 0) {
      for (const symbol of symbols) {
        await this.queryClient.invalidateQueries({
          queryKey: queryKeys.prices.token(symbol),
        })
      }
    } else {
      await this.queryClient.invalidateQueries({
        queryKey: queryKeys.prices.all,
      })
    }
  }
}

/**
 * Create a singleton instance
 */
let orchestratorInstance: InvalidationOrchestrator | null = null

export function getInvalidationOrchestrator(
  queryClient: QueryClient
): InvalidationOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new InvalidationOrchestrator(queryClient)
  }
  return orchestratorInstance
}

/**
 * Hook to use orchestrator in React components
 */
export function useInvalidationOrchestrator(): InvalidationOrchestrator {
  // Import inside hook to avoid circular dependencies
  const { useQueryClient } = require('@tanstack/react-query')
  const queryClient = useQueryClient()
  return getInvalidationOrchestrator(queryClient)
}
