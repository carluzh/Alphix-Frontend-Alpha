import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'
import { buildBackendUrlNoNetwork } from '@/lib/backend-client'

/**
 * Protocol TVL History API
 *
 * Proxies to backend GET /protocol/tvl/history
 * Returns hourly aggregate TVL across all pools and networks for the past 30 days.
 */

const CACHE_TTL = { fresh: 300, stale: 900 } // 5min fresh, 15min stale

interface TvlHistoryPoint {
  timestamp: number
  tvlUsd: number
}

interface TvlHistoryResponse {
  success: boolean
  data: TvlHistoryPoint[]
}

async function fetchProtocolTvlHistory(): Promise<TvlHistoryPoint[]> {
  const url = buildBackendUrlNoNetwork('/protocol/tvl/history')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`)
    }

    const json: TvlHistoryResponse = await response.json()
    if (!json.success || !Array.isArray(json.data)) {
      throw new Error('Invalid response shape')
    }

    return json.data
  } finally {
    clearTimeout(timeout)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
  }

  try {
    const cacheKey = 'protocol:tvl-history'

    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      () => fetchProtocolTvlHistory(),
      { shouldCache: (data) => Array.isArray(data) && data.length > 0 }
    )

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900')
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale')
    }

    return res.status(200).json({ success: true, data: result.data })
  } catch (error) {
    console.error('[protocol/tvl-history] Error:', error)
    return res.status(500).json({ success: false, error: 'Failed to fetch TVL history' })
  }
}
