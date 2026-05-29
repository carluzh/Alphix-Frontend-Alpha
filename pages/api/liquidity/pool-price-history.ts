import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'
import { HistoryDuration, TimestampedPoolPrice } from '@/lib/chart/types'
import { resolveNetworkMode, type NetworkMode } from '@/lib/network-mode'
import { CHAIN_REGISTRY } from '@/lib/chain-registry'
import { UNISWAP_GRAPHQL_GATEWAY, UNISWAP_GRAPHQL_HEADERS } from '@/lib/uniswap/gateway'

/**
 * Pool Price History API
 *
 * Single source: Uniswap Gateway subgraph. Returns AMM-derived `token0Price` /
 * `token1Price` per timestamp. If the gateway doesn't have the pool indexed
 * (e.g. custom-hook AlphixPro pools), the chart shows no line — by design.
 */

// Cache TTL: 15min fresh, 30min stale
const CACHE_TTL = { fresh: 900, stale: 1800 }

interface UniswapPriceHistoryResponse {
  data?: {
    v4Pool?: {
      id: string
      priceHistory?: TimestampedPoolPrice[]
    }
  }
  errors?: Array<{ message: string }>
}

interface ApiResponse {
  data: TimestampedPoolPrice[]
  source: 'uniswap'
  cached?: boolean
}

/**
 * Fetch price history from Uniswap Gateway
 */
async function fetchUniswapPriceHistory(
  poolId: string,
  duration: HistoryDuration,
  networkMode: NetworkMode = 'base'
): Promise<TimestampedPoolPrice[]> {
  const chain = CHAIN_REGISTRY[networkMode]?.apolloChain ?? 'BASE'
  const query = `query GetPoolPriceHistory($poolId: String!, $duration: HistoryDuration!) {
    v4Pool(chain: ${chain}, poolId: $poolId) {
      id
      priceHistory(duration: $duration) {
        timestamp
        token0Price
        token1Price
      }
    }
  }`

  // AbortController timeout pattern for external API
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s for external API

  try {
    const response = await fetch(UNISWAP_GRAPHQL_GATEWAY, {
      method: 'POST',
      headers: UNISWAP_GRAPHQL_HEADERS,
      body: JSON.stringify({ query, variables: { poolId, duration } }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[pool-price-history] Uniswap Gateway returned ${response.status} for pool ${poolId}`)
      return []
    }

    const result: UniswapPriceHistoryResponse = await response.json()

    if (result.errors?.length) {
      console.warn('[pool-price-history] Uniswap Gateway errors:', result.errors)
      return []
    }

    return result.data?.v4Pool?.priceHistory ?? []
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn('[pool-price-history] Uniswap Gateway error:', error)
    return []
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse | { error: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
  }

  const { poolId, duration = 'WEEK' } = req.query

  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ error: 'poolId is required' })
  }

  const networkMode = resolveNetworkMode(req)

  const VALID_DURATIONS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const
  if (duration && !VALID_DURATIONS.includes(duration as typeof VALID_DURATIONS[number])) {
    return res.status(400).json({ error: 'Invalid duration parameter' })
  }
  const historyDuration = (duration as HistoryDuration) || HistoryDuration.WEEK

  const cacheKey = `price-history:${networkMode}:${poolId}:${historyDuration}`

  try {
    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      () => fetchUniswapPriceHistory(poolId, historyDuration, networkMode),
      // Only cache if we have actual data - prevents caching failed/empty responses
      { shouldCache: (data: unknown) => Array.isArray(data) && data.length > 0 }
    )

    res.setHeader('Cache-Control', 'no-store')
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale')
    }

    return res.status(200).json({
      data: result.data,
      source: 'uniswap',
      cached: !result.isStale,
    })
  } catch (error: unknown) {
    console.error('[pool-price-history] Error:', error)
    return res.status(500).json({
      error: 'Failed to fetch price history',
    })
  }
}
