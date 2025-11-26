import type { NextApiRequest, NextApiResponse } from 'next'
import { getPoolSubgraphId } from '@/lib/pools-config'
import { withCache } from '@/lib/redis'
import { cacheKeys, cacheTTL } from '@/lib/cache-keys'

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest"

interface PoolMetrics {
  totalFeesToken0: number
  avgTVLToken0: number
  days: number
}

const POOL_METRICS_QUERY = `
  query PoolMetrics($poolId: String!, $days: Int!) {
    pool(id: $poolId) {
      id
      totalValueLockedToken0
      totalValueLockedToken1
    }
    poolDayDatas(
      where: { pool: $poolId }
      first: $days
      orderBy: date
      orderDirection: desc
    ) {
      date
      volumeToken0
      feesToken0
      tvlUSD
    }
  }
`

async function fetchPoolMetrics(poolId: string, days: number = 7): Promise<PoolMetrics> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: POOL_METRICS_QUERY,
      variables: { poolId: poolId.toLowerCase(), days }
    })
  })

  if (!res.ok) {
    throw new Error(`Subgraph error: ${res.status}`)
  }

  const result = await res.json()
  const pool = result.data?.pool
  const dayDatas = result.data?.poolDayDatas || []

  if (!pool || dayDatas.length === 0) {
    return { totalFeesToken0: 0, avgTVLToken0: 0, days: 0 }
  }

  // Sum fees from day data
  const totalFeesToken0 = dayDatas.reduce(
    (sum: number, day: { feesToken0?: string }) => sum + parseFloat(day.feesToken0 || '0'),
    0
  )

  // Use current TVL from pool
  const avgTVLToken0 = parseFloat(pool.totalValueLockedToken0 || '0')

  return {
    totalFeesToken0,
    avgTVLToken0,
    days: dayDatas.length
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { poolId } = req.query

  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ error: 'poolId required' })
  }

  try {
    const subgraphId = getPoolSubgraphId(poolId) || poolId

    const metrics = await withCache(
      cacheKeys.poolMetrics(subgraphId),
      () => fetchPoolMetrics(subgraphId),
      {
        freshTTL: cacheTTL.poolMetrics.fresh,
        maxTTL: cacheTTL.poolMetrics.max
      }
    )

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')
    return res.status(200).json(metrics)
  } catch (error) {
    console.error('[pool-metrics] Error:', error)
    return res.status(500).json({ error: 'Failed to fetch pool metrics' })
  }
}
