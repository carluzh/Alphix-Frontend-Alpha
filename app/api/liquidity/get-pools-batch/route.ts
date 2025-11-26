import { NextRequest, NextResponse } from 'next/server'
import { getPoolById, getToken } from '@/lib/pools-config'
import { publicClient } from '@/lib/viemClient'
import { parseAbi, getAddress, type Hex } from 'viem'
import { STATE_VIEW_ABI } from '@/lib/abis/state_view_abi'
import { withCache } from '@/lib/redis'
import { cacheKeys, cacheTTL } from '@/lib/cache-keys'

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest"
const STATE_VIEW_ADDRESS = getAddress("0x571291b572ed32ce6751a2cb2486ebee8defb9b4")

// Types
interface PoolStats {
  poolId: string
  tvlUSD: number
  volume24hUSD: number
  fees24hUSD: number
  dynamicFeeBps: number
}

interface PoolConfig {
  id: string
  subgraphId: string
  currency0: { symbol: string }
  currency1: { symbol: string }
}

// Utility functions
function parseTokenAmount(val: unknown, decimals: number): number {
  if (val === null || val === undefined) return 0
  const num = typeof val === 'string' ? parseFloat(val) : Number(val)
  return isNaN(num) ? 0 : num
}

function extractDynamicFeeBps(slot0: readonly [bigint, number, number, number]): number {
  // slot0[3] is the dynamic fee in basis points
  return Number(slot0[3]) || 0
}

// Build GraphQL query dynamically based on pool count
function buildQuery(poolCount: number) {
  return `
    query GetPoolsBatch($poolIds: [String!]!, $cutoffHours: Int!) {
      pools(where: { id_in: $poolIds }) {
        id
        totalValueLockedToken0
        totalValueLockedToken1
      }
      poolHourDatas(
        first: ${poolCount * 25}
        where: { pool_in: $poolIds, periodStartUnix_gte: $cutoffHours }
        orderBy: periodStartUnix
        orderDirection: desc
      ) {
        pool { id }
        volumeToken0
        feesToken0
      }
    }
  `
}

// Core fetcher - extracted for caching
async function fetchPoolsBatchData(poolIds: string[]): Promise<PoolStats[]> {
  // Map pool IDs to their subgraph IDs and configs
  const poolMap = new Map<string, PoolConfig>()
  const subgraphIds: string[] = []

  for (const poolId of poolIds) {
    const config = getPoolById(poolId)
    if (config) {
      const subgraphId = (config.subgraphId || poolId).toLowerCase()
      poolMap.set(subgraphId, config as PoolConfig)
      subgraphIds.push(subgraphId)
    }
  }

  // Fetch on-chain data (slot0 for dynamic fees)
  const stateViewAbi = parseAbi(STATE_VIEW_ABI)
  const slot0Results = await Promise.allSettled(
    Array.from(poolMap.entries()).map(async ([subgraphId]) => {
      try {
        const slot0 = await publicClient.readContract({
          address: STATE_VIEW_ADDRESS,
          abi: stateViewAbi,
          functionName: 'getSlot0',
          args: [subgraphId as Hex]
        }) as readonly [bigint, number, number, number]
        return { subgraphId, slot0 }
      } catch {
        return { subgraphId, slot0: null }
      }
    })
  )

  // Build fee map
  const feeMap = new Map<string, number>()
  for (const result of slot0Results) {
    if (result.status === 'fulfilled' && result.value.slot0) {
      feeMap.set(result.value.subgraphId, extractDynamicFeeBps(result.value.slot0))
    }
  }

  // Fetch subgraph data
  const cutoffHours = Math.floor(Date.now() / 1000) - (24 * 60 * 60)
  const query = buildQuery(poolIds.length)

  const subgraphRes = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { poolIds: subgraphIds, cutoffHours }
    })
  })

  if (!subgraphRes.ok) {
    throw new Error(`Subgraph error: ${subgraphRes.status}`)
  }

  const subgraphData = await subgraphRes.json()
  const pools = subgraphData.data?.pools || []
  const hourDatas = subgraphData.data?.poolHourDatas || []

  // Build TVL map from pools
  const tvlMap = new Map<string, { token0: number; token1: number }>()
  for (const pool of pools) {
    const id = pool.id.toLowerCase()
    tvlMap.set(id, {
      token0: parseTokenAmount(pool.totalValueLockedToken0, 18),
      token1: parseTokenAmount(pool.totalValueLockedToken1, 18)
    })
  }

  // Aggregate hourly data into 24h volume and fees
  const volumeMap = new Map<string, { volume: number; fees: number }>()
  for (const hd of hourDatas) {
    const id = hd.pool.id.toLowerCase()
    const existing = volumeMap.get(id) || { volume: 0, fees: 0 }
    existing.volume += parseTokenAmount(hd.volumeToken0, 18)
    existing.fees += parseTokenAmount(hd.feesToken0, 18)
    volumeMap.set(id, existing)
  }

  // Assemble results
  const results: PoolStats[] = []
  for (const [subgraphId, config] of poolMap.entries()) {
    const tvl = tvlMap.get(subgraphId)
    const volume = volumeMap.get(subgraphId)

    // Get token prices (simplified - using 1.0 for now, real implementation would fetch prices)
    const price0 = 1.0 // TODO: Fetch real prices
    const price1 = 1.0

    const tvlUSD = tvl
      ? (tvl.token0 * price0) + (tvl.token1 * price1)
      : 0

    results.push({
      poolId: config.id,
      tvlUSD,
      volume24hUSD: volume?.volume ?? 0,
      fees24hUSD: volume?.fees ?? 0,
      dynamicFeeBps: feeMap.get(subgraphId) ?? 0
    })
  }

  return results
}

// Validation: at least one pool should have non-zero TVL
function validatePoolsData(data: PoolStats[]): boolean {
  return data.length === 0 || data.some(p => p.tvlUSD > 0)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { poolIds } = body as { poolIds: string[] }

    if (!poolIds || !Array.isArray(poolIds) || poolIds.length === 0) {
      return NextResponse.json({ error: 'poolIds array required' }, { status: 400 })
    }

    const results = await withCache(
      cacheKeys.poolsBatch(),
      () => fetchPoolsBatchData(poolIds),
      {
        freshTTL: cacheTTL.poolsBatch.fresh,
        maxTTL: cacheTTL.poolsBatch.max,
        validate: validatePoolsData
      }
    )

    return NextResponse.json(results, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60'
      }
    })
  } catch (error) {
    console.error('[get-pools-batch] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pool data' },
      { status: 500 }
    )
  }
}
