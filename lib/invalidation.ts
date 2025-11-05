import { QueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryKeys'
import { prefetchService } from '@/lib/prefetch-service'

type OptimisticUpdates = {
  tvlDelta?: number
  volumeDelta?: number
  positionUpdates?: Array<{
    positionId: string
    liquidity0Delta?: number
    liquidity1Delta?: number
  }>
}

type Params = {
  owner: string
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

export async function invalidateAfterTx(qc: QueryClient, params: Params) {
  const ownerLc = (params.owner || '').toLowerCase()

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

        try {
          const revalidateResp = await fetch('/api/internal/revalidate-pools', { method: 'POST' })
          const revalidateData = await revalidateResp.json()
          if (revalidateData.cacheVersion) {
            SafeStorage.set('pools-cache-version', revalidateData.cacheVersion.toString())
          }
          SafeStorage.set('cache:pools-batch:invalidated', 'true')
        } catch (error) {
          console.error('[invalidateAfterTx] Failed to revalidate server cache:', error)
        }

        if (params.refreshPoolData) {
          await params.refreshPoolData()
        }
        invalidateUserPositionIdsCache(ownerLc)
      } catch (error) {
        console.error('[invalidateAfterTx] Subgraph sync failed:', error)
      }
    }

    qc.invalidateQueries({ queryKey: qk.userPositions(ownerLc) })

    if (params.positionIds && params.positionIds.length > 0) {
      const key = params.positionIds.slice().sort().join(',')
      qc.invalidateQueries({ queryKey: qk.uncollectedFeesBatch(key) })
      for (const id of params.positionIds) {
        qc.invalidateQueries({ queryKey: qk.uncollectedFees(id) })
        try {
          const { invalidateCacheEntry } = await import('@/lib/client-cache')
          invalidateCacheEntry(`uncollectedFees_${id}`)
        } catch {}
      }
    }

    if (params.poolId) {
      qc.invalidateQueries({ queryKey: qk.poolStats(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.poolState(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeNow(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.poolChart(params.poolId, 60) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeHistory(params.poolId, 60) })
    }

    qc.invalidateQueries({ queryKey: qk.activity(ownerLc, 50) })

    if (params.positionIds && params.positionIds.length > 0) {
      try {
        const { invalidateCacheEntry } = await import('@/lib/client-cache')
        for (const id of params.positionIds) {
          invalidateCacheEntry(`uncollectedFees_${id}`)
        }
        invalidateCacheEntry(`uncollectedFeesBatch_${params.positionIds.slice().sort().join(',')}`)
      } catch {}
    }

    if (params.reloadPositions) {
      try {
        const { loadUserPositionIds, derivePositionsFromIds } = await import('@/lib/client-cache')
        const ids = await loadUserPositionIds(ownerLc)
        const allDerived = await derivePositionsFromIds(ownerLc, ids)
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

  } catch (error) {
    console.error('[invalidateAfterTx] Top-level error:', error)
    if (params.clearOptimisticStates) {
      try {
        params.clearOptimisticStates()
      } catch {}
    }
  }
}
