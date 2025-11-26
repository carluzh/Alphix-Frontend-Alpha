import { useQuery } from '@tanstack/react-query'
import { getPoolSubgraphId, getEnabledPools } from '@/lib/pools-config'
import type { ProcessedPosition } from '@/pages/api/liquidity/get-positions'

// Types
interface PoolBatchData {
  poolId: string
  tvlUSD: number
  volume24hUSD: number
  fees24hUSD: number
  dynamicFeeBps: number
}

interface PoolAprData {
  poolId: string
  apr7d: number
}

// Fetch batch pool data (TVL, volume, fees)
async function fetchPoolsBatch(poolIds: string[]): Promise<PoolBatchData[]> {
  if (poolIds.length === 0) return []

  const res = await fetch('/api/liquidity/get-pools-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ poolIds }),
  })

  if (!res.ok) throw new Error('Failed to fetch pools batch')

  const data: PoolBatchData[] = await res.json()

  // Validate: at least one pool should have non-zero TVL
  // (TVL should never be 0 for active pools - indicates subgraph lag)
  const hasValidData = data.some(p => p.tvlUSD > 0)
  if (!hasValidData && data.length > 0) {
    throw new Error('Invalid data: all TVL values are zero')
  }

  return data
}

// Fetch APR data with rate limiting
async function fetchPoolsAprBatch(poolIds: string[]): Promise<PoolAprData[]> {
  if (poolIds.length === 0) return []

  const results: PoolAprData[] = []
  let hasAnyValidApr = false

  for (let i = 0; i < poolIds.length; i++) {
    const poolId = poolIds[i]
    const subgraphId = getPoolSubgraphId(poolId) || poolId

    try {
      const res = await fetch(`/api/liquidity/pool-metrics?poolId=${subgraphId}`)
      if (!res.ok) {
        results.push({ poolId, apr7d: 0 })
        continue
      }

      const metrics = await res.json()
      const { totalFeesToken0 = 0, avgTVLToken0 = 0, days = 0 } = metrics || {}

      let apr7d = 0
      if (avgTVLToken0 > 0 && days > 0) {
        apr7d = ((totalFeesToken0 / days) * 365 / avgTVLToken0) * 100
        if (!isFinite(apr7d) || apr7d < 0) apr7d = 0
      }

      if (apr7d > 0) hasAnyValidApr = true
      results.push({ poolId, apr7d })
    } catch {
      results.push({ poolId, apr7d: 0 })
    }

    // Rate limit: 150ms between requests
    if (i < poolIds.length - 1) {
      await new Promise(r => setTimeout(r, 150))
    }
  }

  // Validate: at least one pool should have non-zero APR
  if (!hasAnyValidApr && results.length > 0) {
    throw new Error('Invalid data: all APR values are zero')
  }

  return results
}

// Fetch user positions
async function fetchUserPositions(ownerAddress: string): Promise<ProcessedPosition[]> {
  const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${ownerAddress}`)
  if (!res.ok) throw new Error('Failed to fetch positions')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// Hook: Batch pool data (5-min stale time)
export function usePoolsBatch(poolIds: string[]) {
  return useQuery({
    queryKey: ['pools-batch', poolIds],
    queryFn: () => fetchPoolsBatch(poolIds),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: poolIds.length > 0,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000), // 1s, 2s, 4s, 8s, 10s
  })
}

// Hook: APR data (1-hour stale time - slower changing)
export function usePoolsAprBatch(poolIds: string[]) {
  return useQuery({
    queryKey: ['pools-apr-batch', poolIds],
    queryFn: () => fetchPoolsAprBatch(poolIds),
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    enabled: poolIds.length > 0,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  })
}

// Hook: User positions
export function useUserPositions(ownerAddress: string | undefined) {
  return useQuery({
    queryKey: ['user-positions', ownerAddress],
    queryFn: () => fetchUserPositions(ownerAddress!),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!ownerAddress,
  })
}

// Hook: Get enabled pool IDs
export function useEnabledPoolIds() {
  return getEnabledPools().map(p => p.id)
}
