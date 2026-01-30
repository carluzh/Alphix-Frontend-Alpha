import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'
import { HistoryDuration, TimestampedPoolPrice } from '@/lib/chart/types'
import { fetchPoolPricesHistory } from '@/lib/backend-client'
import type { NetworkMode } from '@/lib/network-mode'

/**
 * Pool Price History API
 *
 * Fetches historical price data with network-aware source selection:
 * - Mainnet: Uniswap Gateway (primary) → Backend → CoinGecko (fallback)
 * - Testnet: Backend (primary, only source available)
 *
 * Returns token0Price and token1Price for flexible client-side denomination.
 *
 * @see interface/apps/web/src/hooks/usePoolPriceChartData.tsx
 */

// Uniswap Gateway configuration
const UNISWAP_GATEWAY = 'https://interface.gateway.uniswap.org/v1/graphql'
const UNISWAP_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

// Cache TTL: 15min fresh, 30min stale
const CACHE_TTL = { fresh: 900, stale: 1800 }

// CoinGecko fallback configuration (temporary - goal is to remove)
const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'atETH': 'ethereum',
  'USDC': 'usd-coin',
  'atUSDC': 'usd-coin',
  'USDS': 'usds',
  'atDAI': 'dai',
}

// Only USDC is the quote currency ($1.00)
const STABLECOINS = ['USDC', 'USDS', 'atUSDC', 'atDAI']

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
  source: 'uniswap' | 'backend' | 'coingecko'
  cached?: boolean
}

/**
 * Fetch price history from Uniswap Gateway
 */
async function fetchUniswapPriceHistory(
  poolId: string,
  duration: HistoryDuration
): Promise<TimestampedPoolPrice[] | null> {
  const query = `query GetPoolPriceHistory($poolId: String!, $duration: HistoryDuration!) {
    v4Pool(chain: BASE, poolId: $poolId) {
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
    const response = await fetch(UNISWAP_GATEWAY, {
      method: 'POST',
      headers: UNISWAP_HEADERS,
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
 * Fetch price history from CoinGecko (fallback)
 * Converts to TimestampedPoolPrice format for consistency
 */
async function fetchCoinGeckoPriceHistory(
  token0: string,
  token1: string,
  duration: HistoryDuration
): Promise<TimestampedPoolPrice[] | null> {
  const token0Id = COINGECKO_IDS[token0]
  const token1Id = COINGECKO_IDS[token1]

  if (!token0Id || !token1Id) {
    console.warn(`[pool-price-history] No CoinGecko ID for ${token0} or ${token1}`)
    return null
  }

  // Map duration to CoinGecko days parameter
  const daysMap: Record<HistoryDuration, number> = {
    [HistoryDuration.HOUR]: 1,
    [HistoryDuration.DAY]: 1,
    [HistoryDuration.WEEK]: 7,
    [HistoryDuration.MONTH]: 30,
    [HistoryDuration.YEAR]: 365,
  }
  const days = daysMap[duration] || 7

  try {
    const isToken0Stable = STABLECOINS.includes(token0)
    const isToken1Stable = STABLECOINS.includes(token1)

    // Fetch prices based on token stability
    // AbortController timeout pattern for CoinGecko API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s for external API

    if (isToken0Stable && !isToken1Stable) {
      // token0 is stable - fetch token1 price
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${token1Id}/market_chart?vs_currency=usd&days=${days}`,
        { headers: { 'Accept': 'application/json' }, signal: controller.signal }
      )
      clearTimeout(timeoutId)
      if (!response.ok) return null

      const result = await response.json()
      return (result.prices || []).map((p: [number, number]) => ({
        timestamp: Math.floor(p[0] / 1000),
        token0Price: 1 / p[1], // Inverse: how much token0 per token1
        token1Price: p[1],     // Direct: USD price of token1
      }))
    } else if (!isToken0Stable && isToken1Stable) {
      // token1 is stable - fetch token0 price
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${token0Id}/market_chart?vs_currency=usd&days=${days}`,
        { headers: { 'Accept': 'application/json' }, signal: controller.signal }
      )
      clearTimeout(timeoutId)
      if (!response.ok) return null

      const result = await response.json()
      return (result.prices || []).map((p: [number, number]) => ({
        timestamp: Math.floor(p[0] / 1000),
        token0Price: p[1],     // Direct: USD price of token0
        token1Price: 1 / p[1], // Inverse: how much token1 per token0
      }))
    } else {
      // Both stable or both non-stable - fetch both and calculate ratio
      // Promise.allSettled pattern (identical to Uniswap getPool.ts)
      // AbortController timeout for parallel fetches
      const controller0 = new AbortController()
      const controller1 = new AbortController()
      const timeoutId0 = setTimeout(() => controller0.abort(), 15000)
      const timeoutId1 = setTimeout(() => controller1.abort(), 15000)

      const [res0Result, res1Result] = await Promise.allSettled([
        fetch(`https://api.coingecko.com/api/v3/coins/${token0Id}/market_chart?vs_currency=usd&days=${days}`, {
          headers: { 'Accept': 'application/json' },
          signal: controller0.signal
        }),
        fetch(`https://api.coingecko.com/api/v3/coins/${token1Id}/market_chart?vs_currency=usd&days=${days}`, {
          headers: { 'Accept': 'application/json' },
          signal: controller1.signal
        })
      ])

      clearTimeout(timeoutId)
      clearTimeout(timeoutId0)
      clearTimeout(timeoutId1)

      // Extract results - both required for ratio calculation
      const res0 = res0Result.status === 'fulfilled' ? res0Result.value : null
      const res1 = res1Result.status === 'fulfilled' ? res1Result.value : null
      if (!res0 || !res1 || !res0.ok || !res1.ok) return null

      const [json0Result, json1Result] = await Promise.allSettled([res0.json(), res1.json()])
      if (json0Result.status !== 'fulfilled' || json1Result.status !== 'fulfilled') return null
      const result0 = json0Result.value;
      const result1 = json1Result.value;
      const prices0 = result0.prices || []
      const prices1 = result1.prices || []

      // Use token1 timestamps as base, find matching token0 prices
      return prices1.map((p1: [number, number], i: number) => {
        const p0 = prices0[i] || prices0[prices0.length - 1]
        const token0USD = p0[1]
        const token1USD = p1[1]
        return {
          timestamp: Math.floor(p1[0] / 1000),
          token0Price: token0USD / token1USD, // token0 in terms of token1
          token1Price: token1USD / token0USD, // token1 in terms of token0
        }
      })
    }
  } catch (error) {
    console.warn('[pool-price-history] CoinGecko error:', error)
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
 * Works for both mainnet and testnet
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
 * Combined fetch — TEMPORARY: Uniswap Gateway API only (no backend/CoinGecko fallback).
 */
async function fetchPriceHistory(
  poolId: string,
  _token0: string,
  _token1: string,
  duration: HistoryDuration,
  _networkMode: NetworkMode
): Promise<{ data: TimestampedPoolPrice[]; source: 'uniswap' | 'backend' | 'coingecko' }> {
  const uniswapData = await fetchUniswapPriceHistory(poolId, duration)
  if (uniswapData && uniswapData.length >= 3) {
    return { data: uniswapData, source: 'uniswap' }
  }

  console.warn(`[pool-price-history] Uniswap Gateway returned no data for pool ${poolId}`)
  return { data: [], source: 'uniswap' }
}

/**
 * Fetch with optional CoinGecko fallback
 * Used when called from GraphQL where token symbols may not be available
 *
 * TEMPORARY: Solely uses Uniswap Gateway API (spoofed header).
 * Backend and CoinGecko fallbacks disabled while investigating fee data issues.
 */
async function fetchPriceHistoryWithOptionalFallback(
  poolId: string,
  _token0: string | null,
  _token1: string | null,
  duration: HistoryDuration,
  _networkMode: NetworkMode
): Promise<{ data: TimestampedPoolPrice[]; source: 'uniswap' | 'backend' | 'coingecko' }> {
  // TEMPORARY: Always use Uniswap Gateway API only (no backend/CoinGecko fallback)
  const uniswapData = await fetchUniswapPriceHistory(poolId, duration)
  if (uniswapData && uniswapData.length >= 3) {
    return { data: uniswapData, source: 'uniswap' }
  }

  console.warn(`[pool-price-history] Uniswap Gateway returned no data for pool ${poolId}`)
  return { data: [], source: 'uniswap' }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse | { message: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` })
  }

  const { poolId, token0, token1, duration = 'WEEK', network = 'mainnet' } = req.query

  if (!poolId || typeof poolId !== 'string') {
    return res.status(400).json({ message: 'poolId is required' })
  }

  // Validate network mode
  const networkMode: NetworkMode = network === 'testnet' ? 'testnet' : 'mainnet'

  // token0/token1 are optional - only needed for CoinGecko fallback
  // If not provided, skip CoinGecko fallback entirely
  const hasTokens = token0 && typeof token0 === 'string' && token1 && typeof token1 === 'string'

  const VALID_DURATIONS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const
  if (duration && !VALID_DURATIONS.includes(duration as typeof VALID_DURATIONS[number])) {
    return res.status(400).json({ message: 'Invalid duration parameter' })
  }
  const historyDuration = (duration as HistoryDuration) || HistoryDuration.WEEK

  // Cache key includes poolId, tokens (if provided), duration, and network to prevent cache poisoning
  const cacheKey = hasTokens
    ? `price-history:${networkMode}:${poolId}:${token0}:${token1}:${historyDuration}`
    : `price-history:${networkMode}:${poolId}:${historyDuration}`

  try {
    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      () => fetchPriceHistoryWithOptionalFallback(poolId, hasTokens ? token0 as string : null, hasTokens ? token1 as string : null, historyDuration, networkMode),
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
      message: 'Failed to fetch price history',
    })
  }
}
