import { QueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryKeys'
import { prefetchService } from '@/lib/prefetch-service'

export type OptimisticUpdates = {
  tvlDelta?: number
  volumeDelta?: number
  positionUpdates?: Array<{
    positionId: string
    liquidity0Delta?: number
    liquidity1Delta?: number
  }>
  // New: Support for adding/removing positions
  addPendingPosition?: {
    positionId: string // Temporary ID (use tx hash or similar)
    poolId: string
    tickLower: number
    tickUpper: number
    isPending: true
  }
  removePosition?: {
    positionId: string
  }
  // New: Support for fee claims
  clearFees?: {
    positionId: string
  }
}

type Params = {
  owner: string
  chainId: number
  poolId?: string
  positionIds?: string[]
  reason?: string
  awaitSubgraphSync?: boolean
  blockNumber?: bigint
  reloadPositions?: boolean
  onPositionsReloaded?: (positions: any[]) => void
  clearOptimisticStates?: () => void
  refreshPoolData?: () => Promise<void>
  optimisticUpdates?: OptimisticUpdates
}

/**
 * Invalidate caches after a transaction
 *
 * This function orchestrates cache invalidation across multiple layers:
 * 1. Optimistic updates (immediate UI feedback)
 * 2. Subgraph sync coordination (wait for indexing)
 * 3. Redis cache invalidation (server-side)
 * 4. React Query invalidation (client-side)
 */
export async function invalidateAfterTx(qc: QueryClient, params: Params) {
  const ownerLc = (params.owner || '').toLowerCase()

  console.log('[invalidateAfterTx] Called with params:', {
    owner: ownerLc,
    poolId: params.poolId,
    positionIds: params.positionIds,
    reason: params.reason,
    awaitSubgraphSync: params.awaitSubgraphSync,
    blockNumber: params.blockNumber?.toString(),
    hasOptimisticUpdates: !!params.optimisticUpdates,
    optimisticUpdates: params.optimisticUpdates
  });

  try {
    const hasOptimisticUpdates = !!params.optimisticUpdates;

    if (hasOptimisticUpdates) {
      try {
        if (params.poolId && (params.optimisticUpdates!.tvlDelta !== undefined || params.optimisticUpdates!.volumeDelta !== undefined)) {
          qc.setQueryData(qk.poolStats(params.poolId), (old: any) => {
            if (!old) return old
            const updated = { ...old }
            if (params.optimisticUpdates!.tvlDelta !== undefined) {
              updated.tvlUSD = Math.max(0, (old.tvlUSD || 0) + params.optimisticUpdates!.tvlDelta)
            }
            if (params.optimisticUpdates!.volumeDelta !== undefined) {
              updated.volume24hUSD = Math.max(0, (old.volume24hUSD || 0) + params.optimisticUpdates!.volumeDelta)
            }
            return updated
          })
        }

        // Handle position liquidity updates
        if (params.optimisticUpdates!.positionUpdates && params.optimisticUpdates!.positionUpdates.length > 0) {
          qc.setQueryData(qk.userPositions(ownerLc), (old: any) => {
            if (!Array.isArray(old)) return old
            return old.map((position: any) => {
              const update = params.optimisticUpdates!.positionUpdates!.find(
                (u) => u.positionId === position.positionId
              )
              if (!update) return position
              return {
                ...position,
                token0: update.liquidity0Delta !== undefined ? {
                  ...position.token0,
                  amount: String(Math.max(0, parseFloat(position.token0?.amount || '0') + update.liquidity0Delta))
                } : position.token0,
                token1: update.liquidity1Delta !== undefined ? {
                  ...position.token1,
                  amount: String(Math.max(0, parseFloat(position.token1?.amount || '0') + update.liquidity1Delta))
                } : position.token1,
                isOptimisticallyUpdating: true,
              }
            })
          })
        }

        // Handle adding pending position (mint - show skeleton)
        if (params.optimisticUpdates!.addPendingPosition) {
          qc.setQueryData(qk.userPositions(ownerLc), (old: any) => {
            if (!Array.isArray(old)) return []
            const pending = params.optimisticUpdates!.addPendingPosition!
            const skeleton = {
              positionId: pending.positionId,
              poolId: pending.poolId,
              tickLower: pending.tickLower,
              tickUpper: pending.tickUpper,
              isPending: true,
              isOptimisticallyUpdating: true,
              owner: ownerLc,
              token0: { address: '', symbol: '...', amount: '0', rawAmount: '0' },
              token1: { address: '', symbol: '...', amount: '0', rawAmount: '0' },
              liquidityRaw: '0',
              ageSeconds: 0,
              blockTimestamp: Math.floor(Date.now() / 1000),
              lastTimestamp: Math.floor(Date.now() / 1000),
              isInRange: true,
            }
            // Add to beginning of list
            return [skeleton, ...old]
          })
        }

        // Handle removing position (burn)
        if (params.optimisticUpdates!.removePosition) {
          qc.setQueryData(qk.userPositions(ownerLc), (old: any) => {
            if (!Array.isArray(old)) return old
            const positionId = params.optimisticUpdates!.removePosition!.positionId
            // Mark as removing for fade-out animation, or remove immediately
            return old.map((position: any) =>
              position.positionId === positionId
                ? { ...position, isRemoving: true, isOptimisticallyUpdating: true }
                : position
            )
          })
        }

        // Handle fee claim
        if (params.optimisticUpdates!.clearFees) {
          const positionId = params.optimisticUpdates!.clearFees.positionId
          // Invalidate fee queries immediately
          qc.setQueryData(qk.uncollectedFees(positionId), () => ({
            token0Fees: '0',
            token1Fees: '0',
            token0FeesUSD: 0,
            token1FeesUSD: 0,
            totalFeesUSD: 0,
          }))
        }
      } catch (error) {
        console.error('[invalidateAfterTx] Optimistic update failed:', error)
      }
    }

    if (hasOptimisticUpdates && !params.awaitSubgraphSync) {
      return;
    }

    if (params.awaitSubgraphSync) {
      try {
        const { publicClient } = await import('@/lib/viemClient')
        const { waitForSubgraphBlock, setIndexingBarrier, invalidateUserPositionIdsCache } = await import('@/lib/client-cache')
        const { SafeStorage } = await import('@/lib/safe-storage')

        const targetBlock = params.blockNumber ?? await publicClient.getBlockNumber()
        const barrier = waitForSubgraphBlock(Number(targetBlock), {
          timeoutMs: 45000,
          minWaitMs: 3000,
          maxIntervalMs: 3000
        })
        setIndexingBarrier(ownerLc, barrier)
        await barrier
        await new Promise(resolve => setTimeout(resolve, 2000))

        if (params.refreshPoolData) {
          await params.refreshPoolData()
        }
        invalidateUserPositionIdsCache(ownerLc)
      } catch (error) {
        console.error('[invalidateAfterTx] Subgraph sync failed:', error)
      }
    }

    // Invalidate React Query caches (client-side)
    console.log('[invalidateAfterTx] Invalidating React Query caches');
    qc.invalidateQueries({ queryKey: qk.userPositions(ownerLc) })

    if (params.positionIds && params.positionIds.length > 0) {
      const key = params.positionIds.slice().sort().join(',')
      qc.invalidateQueries({ queryKey: qk.uncollectedFeesBatch(key) })
      for (const id of params.positionIds) {
        qc.invalidateQueries({ queryKey: qk.uncollectedFees(id) })
      }
    }

    if (params.poolId) {
      console.log(`[invalidateAfterTx] Invalidating pool queries for poolId: ${params.poolId}`);
      qc.invalidateQueries({ queryKey: qk.poolStats(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.poolState(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeNow(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.poolChart(params.poolId, 60) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeHistory(params.poolId, 60) })
    }

    // Note: Activity feed removed - no longer invalidating qk.activity()

    // Invalidate Redis caches (server-side) via API call
    console.log('[invalidateAfterTx] Calling Redis cache invalidation API');
    try {
      const requestBody = {
        ownerAddress: ownerLc,
        poolId: params.poolId,
        positionIds: params.positionIds,
        reason: params.reason || 'tx_confirmed'
      };
      console.log('[invalidateAfterTx] Redis invalidation request:', requestBody);

      const response = await fetch('/api/cache/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      console.log('[invalidateAfterTx] Redis invalidation response status:', response.status);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[invalidateAfterTx] Redis invalidation failed with status:', response.status, errorText);
      } else {
        const result = await response.json();
        console.log('[invalidateAfterTx] Redis invalidation succeeded:', result);
      }
    } catch (error) {
      console.error('[invalidateAfterTx] Redis cache invalidation failed:', error)
      // Non-blocking - continue with other invalidations
    }

    if (params.reloadPositions) {
      try {
        const { loadUserPositionIds, getCachedPositionTimestamps } = await import('@/lib/client-cache')
        const { derivePositionsFromIds } = await import('@/lib/on-chain-data')
        const ids = await loadUserPositionIds(ownerLc)
        const timestamps = getCachedPositionTimestamps(ownerLc)
        const allDerived = await derivePositionsFromIds(ownerLc, ids, params.chainId, timestamps)

        // Update React Query cache with fresh data, replacing pending positions and removing deleted ones
        qc.setQueryData(qk.userPositions(ownerLc), (old: any) => {
          if (!Array.isArray(old)) return allDerived

          // Filter out positions marked as removing or pending
          const realPositions = old.filter((p: any) => !p.isRemoving && !p.isPending)

          // Merge with fresh data (prefer fresh over old)
          const freshIds = new Set(allDerived.map((p: any) => p.positionId))
          const preserved = realPositions.filter((p: any) => !freshIds.has(p.positionId))

          return [...allDerived, ...preserved]
        })

        if (params.onPositionsReloaded) {
          params.onPositionsReloaded(allDerived)
        }
      } catch (error) {
        console.error('[invalidateAfterTx] Position reload failed:', error)
      }
    }

    if (params.clearOptimisticStates) {
      try {
        params.clearOptimisticStates()
      } catch (error) {
        console.error('[invalidateAfterTx] Clear optimistic states failed:', error)
      }
    }

    try {
      prefetchService.notifyPositionsRefresh(ownerLc, params.reason || 'tx_confirmed')
    } catch {}

    console.log('[invalidateAfterTx] Completed successfully');

  } catch (error) {
    console.error('[invalidateAfterTx] Top-level error:', error)
    if (params.clearOptimisticStates) {
      try {
        params.clearOptimisticStates()
      } catch {}
    }
  }
}
