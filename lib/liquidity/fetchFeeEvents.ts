import { getAlphixSubgraphUrl } from '@/lib/subgraph-url-helper'
import type { NetworkMode } from '@/lib/network-mode'

const GET_LAST_HOOK_EVENTS = `
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

export type HookEvent = {
  timestamp: string
  newFeeBps?: string
  currentRatio?: string
  newTargetRatio?: string
  oldTargetRatio?: string
}

type HookResp = { data?: { alphixHooks?: HookEvent[] }; errors?: any[] }

/**
 * Fetch historical dynamic fee events from the Alphix subgraph.
 * Shared between the API route and pool-metrics (avoids HTTP self-call).
 */
export async function fetchFeeEvents(
  poolId: string,
  networkMode: NetworkMode
): Promise<HookEvent[]> {
  const SUBGRAPH_URL = getAlphixSubgraphUrl(networkMode)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  const resp = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_LAST_HOOK_EVENTS,
      variables: { poolId: poolId.toLowerCase() },
    }),
    signal: controller.signal,
  })

  clearTimeout(timeoutId)

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Subgraph error: ${body}`)
  }

  const json = (await resp.json()) as HookResp
  if (json.errors) {
    throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`)
  }

  return Array.isArray(json.data?.alphixHooks) ? json.data!.alphixHooks! : []
}
