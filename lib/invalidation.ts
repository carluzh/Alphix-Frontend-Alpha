import { QueryClient } from '@tanstack/react-query'
import { qk } from '@/lib/queryKeys'
import { prefetchService } from '@/lib/prefetch-service'

type Params = {
  owner: string
  poolId?: string
  positionIds?: string[]
  reason?: string
}

export async function invalidateAfterTx(qc: QueryClient, params: Params) {
  const ownerLc = (params.owner || '').toLowerCase()
  try {
    // User-centric
    qc.invalidateQueries({ queryKey: qk.userPositions(ownerLc) })
    if (params.positionIds && params.positionIds.length > 0) {
      const key = params.positionIds.slice().sort().join(',')
      qc.invalidateQueries({ queryKey: qk.uncollectedFeesBatch(key) })
      for (const id of params.positionIds) {
        qc.invalidateQueries({ queryKey: qk.uncollectedFees(id) })
      }
    }

    // Pool-centric - invalidate all relevant data
    if (params.poolId) {
      // Core pool data (state, fees)
      qc.invalidateQueries({ queryKey: qk.poolStats(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.poolState(params.poolId) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeNow(params.poolId) })

      // Chart data - invalidate when user actions affect TVL/volume
      qc.invalidateQueries({ queryKey: qk.poolChart(params.poolId, 60) })
      qc.invalidateQueries({ queryKey: qk.dynamicFeeHistory(params.poolId, 60) })
    }

    // Activity data - invalidate when any user action occurs
    qc.invalidateQueries({ queryKey: qk.activity(ownerLc, 50) })

    // Back-compat: existing prefetch bus
    prefetchService.requestPositionsRefresh({
      owner: ownerLc,
      reason: params.reason || 'tx_confirmed',
      poolIds: params.poolId ? [params.poolId] : undefined,
      tokenIds: params.positionIds,
      debounceMs: 100,
    })
  } catch {}
}



