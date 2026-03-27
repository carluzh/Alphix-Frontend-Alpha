import { getAlphixSubgraphUrl } from '@/lib/subgraph-url-helper'
import { buildBackendUrl } from '@/lib/backend-client'
import { getPoolByIdMultiChain } from '@/lib/pools-config'
import { isLvrFeePool } from '@/lib/liquidity/utils/pool-type-guards'
import type { NetworkMode } from '@/lib/network-mode'

export type HookEvent = {
  timestamp: string
  newFeeBps?: string
  currentRatio?: string
  newTargetRatio?: string
  oldTargetRatio?: string
  volatility?: number
  agentAdjustment?: number
}

const SUBGRAPH_QUERY = `
  query GetLastHookEvents($poolId: Bytes!) {
    alphixHooks(
      where: { pool: $poolId }
      orderBy: timestamp
      orderDirection: desc
      first: 500
    ) {
      timestamp
      newFeeBps
      currentRatio
      newTargetRatio
      oldTargetRatio
    }
  }
`

type SubgraphResp = { data?: { alphixHooks?: HookEvent[] }; errors?: any[] }

/**
 * Fetch historical dynamic fee events.
 * Routes by pool type:
 * - Alphix hook pools → subgraph (alphixHooks entity)
 * - LVRFee pools → backend REST API
 */
export async function fetchFeeEvents(
  poolId: string,
  networkMode: NetworkMode
): Promise<HookEvent[]> {
  const pool = getPoolByIdMultiChain(poolId)

  try {
    if (pool && isLvrFeePool(pool)) {
      return await fetchFromBackend(poolId, networkMode)
    }
    return await fetchFromSubgraph(poolId, networkMode)
  } catch (err) {
    console.error(`[fetchFeeEvents] Failed for pool ${poolId}:`, err)
    return []
  }
}

async function fetchFromSubgraph(poolId: string, networkMode: NetworkMode): Promise<HookEvent[]> {
  const url = getAlphixSubgraphUrl(networkMode)
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: SUBGRAPH_QUERY,
      variables: { poolId: poolId.toLowerCase() },
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok) throw new Error(`Subgraph HTTP ${resp.status}`)
  const json = (await resp.json()) as SubgraphResp
  if (json.errors) throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`)
  return Array.isArray(json.data?.alphixHooks) ? json.data!.alphixHooks! : []
}

async function fetchFromBackend(poolId: string, networkMode: NetworkMode): Promise<HookEvent[]> {
  const url = buildBackendUrl('/api/liquidity/get-historical-dynamic-fees', networkMode, {
    poolId: poolId.toLowerCase(),
    limit: '500',
  })
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!resp.ok) throw new Error(`Backend HTTP ${resp.status}`)

  const json = await resp.json()
  const items: any[] = Array.isArray(json) ? json : (json.data ?? [])
  return items.map((e: any) => ({
    timestamp: String(e.timestamp),
    newFeeBps: String(e.newFeeBps ?? e.newFeeRateBps ?? 0),
    volatility: e.volatility != null ? Number(e.volatility) : undefined,
    agentAdjustment: e.agentAdjustment ?? e.agent_adjustment != null ? Number(e.agentAdjustment ?? e.agent_adjustment) : undefined,
  }))
}
