import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'
import { HistoryDuration, TimestampedPoolPrice } from '@/lib/chart/types'
import { fetchPoolPricesHistory } from '@/lib/backend-client'
import { resolveNetworkMode, type NetworkMode } from '@/lib/network-mode'
import { CHAIN_REGISTRY } from '@/lib/chain-registry'
import { UNISWAP_GRAPHQL_GATEWAY, UNISWAP_GRAPHQL_HEADERS } from '@/lib/uniswap/gateway'

/**
 * Pool Price History API
 *
 * Fetches historical price data with network-aware source selection:
 * - Uniswap Gateway (primary) → Backend (fallback)
 *
 * Returns token0Price and token1Price for flexible client-side denomination.
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
  source: 'uniswap' | 'backend'
  cached?: boolean
}

/**
 * Fetch price history from Uniswap Gateway
 */
async function fetchUniswapPriceHistory(
  poolId: string,
  duration: HistoryDuration,
  networkMode: NetworkMode = 'base'
): Promise<TimestampedPoolPrice[] | null> {
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
      console.warn(`[pool-price-history] Uniswap Gateway returned ${response.status}`)
      return null
    }

    const result: UniswapPriceHistoryResponse = await response.json()

    if (result.errors?.length) {
      console.warn('[pool-price-history] Uniswap Gateway errors:', result.errors)
      return null
    }

    return result.data?.v4Pool?.priceHistory ?? null
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn('[pool-price-history] Uniswap Gateway error:', error)
    return null
  }
}

/**
 * Map HistoryDuration to backend period format
 */
function mapDurationToBackendPeriod(duration: HistoryDuration): 'DAY' | 'WEEK' | 'MONTH' {
  switch (duration) {
    case HistoryDuration.HOUR:
    case HistoryDuration.DAY:
      return 'DAY'
    case HistoryDuration.WEEK:
      return 'WEEK'
    case HistoryDuration.MONTH:
    case HistoryDuration.YEAR:
      return 'MONTH'
    default:
      return 'WEEK'
  }
}

/**
 * Fetch price history from Alphix Backend
 * Works for all supported networks
 */
async function fetchBackendPriceHistory(
  poolId: string,
  duration: HistoryDuration,
  networkMode: NetworkMode
): Promise<TimestampedPoolPrice[] | null> {
  try {
    const period = mapDurationToBackendPeriod(duration)
    const result = await fetchPoolPricesHistory(poolId, period, networkMode)

    if (!result.success || !result.points?.length) {
      return null
    }

    // Convert to TimestampedPoolPrice format
    // Backend returns USD prices, but chart needs token-to-token ratios
    // to align with tick-based range bounds
    //
    // NOTE: Backend returns tokens in opposite order from subgraph convention.
    // Subgraph orders by address (token0 < token1), backend uses pool config order.
    // We swap the calculation to align with subgraph/Uniswap expectations:
    //
    // token0Price = price of token0 in token1 terms = token1Usd / token0Usd
    // token1Price = price of token1 in token0 terms = token0Usd / token1Usd
    return result.points.map((p) => {
      const token0Usd = p.token0PriceUsd || 1
      const token1Usd = p.token1PriceUsd || 1
      return {
        timestamp: p.timestamp,
        token0Price: token1Usd / token0Usd,  // Swapped: aligns with subgraph token ordering
        token1Price: token0Usd / token1Usd,  // Swapped: aligns with subgraph token ordering
      }
    })
  } catch (error) {
    console.warn('[pool-price-history] Backend error:', error)
    return null
  }
}

/**
 * Fetch price history: Uniswap Gateway (primary) → Backend (fallback)
 */
async function fetchPriceHistoryWithFallback(
  poolId: string,
  duration: HistoryDuration,
  networkMode: NetworkMode
): Promise<{ data: TimestampedPoolPrice[]; source: 'uniswap' | 'backend' }> {
  // Try Uniswap Gateway first
  const uniswapData = await fetchUniswapPriceHistory(poolId, duration, networkMode)
  if (uniswapData && uniswapData.length >= 3) {
    return { data: uniswapData, source: 'uniswap' }
  }

  // Fallback to backend (supports all chains)
  console.warn(`[pool-price-history] Uniswap Gateway returned no data for pool ${poolId}, trying backend`)
  const backendData = await fetchBackendPriceHistory(poolId, duration, networkMode)
  if (backendData && backendData.length >= 3) {
    return { data: backendData, source: 'backend' }
  }

  console.warn(`[pool-price-history] No price history available for pool ${poolId} (networkMode=${networkMode})`)
  return { data: [], source: 'backend' }
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
      () => fetchPriceHistoryWithFallback(poolId, historyDuration, networkMode),
      // Only cache if we have actual data - prevents caching failed/empty responses
      { shouldCache: (data: any) => data?.data && data.data.length > 0 }
    )

    res.setHeader('Cache-Control', 'no-store')
    if (result.isStale) {
      res.setHeader('X-Cache-Status', 'stale')
    }

    return res.status(200).json({
      data: result.data.data,
      source: result.data.source,
      cached: !result.isStale,
    })
  } catch (error: unknown) {
    console.error('[pool-price-history] Error:', error)
    return res.status(500).json({
      error: 'Failed to fetch price history',
    })
  }
}
