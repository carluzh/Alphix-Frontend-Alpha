import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheService } from '@/lib/cache/CacheService'

/**
 * Token Price History API
 *
 * Fetches historical USD price data from CoinGecko for portfolio chart calculations.
 * Returns timestamped prices that can be used to calculate historical portfolio value.
 */

// CoinGecko token ID mapping
const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'aETH': 'ethereum',
  'USDC': 'usd-coin',
  'aUSDC': 'usd-coin',
  'USDT': 'tether',
  'aUSDT': 'tether',
  'mUSDT': 'tether',
}

// Cache TTL: 30min fresh, 1hr stale (price history doesn't change often)
const CACHE_TTL = { fresh: 1800, stale: 3600 }

export type HistoryPeriod = 'DAY' | 'WEEK' | 'MONTH'

interface PricePoint {
  timestamp: number // Unix seconds
  price: number // USD price
}

interface TokenPriceHistoryResponse {
  prices: PricePoint[]
  symbol: string
  period: HistoryPeriod
}

/**
 * Fetch historical USD prices from CoinGecko
 */
async function fetchCoinGeckoPriceHistory(
  symbol: string,
  period: HistoryPeriod
): Promise<PricePoint[]> {
  const coingeckoId = COINGECKO_IDS[symbol.toUpperCase()]

  if (!coingeckoId) {
    console.warn(`[token-price-history] No CoinGecko ID for ${symbol}`)
    return []
  }

  // Map period to CoinGecko days parameter
  const daysMap: Record<HistoryPeriod, number> = {
    'DAY': 1,
    'WEEK': 7,
    'MONTH': 30,
  }
  const days = daysMap[period] || 7

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      }
    )
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[token-price-history] CoinGecko returned ${response.status}`)
      return []
    }

    const result = await response.json()

    // CoinGecko returns prices as [[timestamp_ms, price], ...]
    return (result.prices || []).map((p: [number, number]) => ({
      timestamp: Math.floor(p[0] / 1000), // Convert to Unix seconds
      price: p[1],
    }))
  } catch (error) {
    clearTimeout(timeoutId)
    console.warn('[token-price-history] CoinGecko error:', error)
    return []
  }
}

/**
 * Generate stablecoin price history (always ~$1)
 */
function generateStablecoinHistory(period: HistoryPeriod): PricePoint[] {
  const now = Math.floor(Date.now() / 1000)
  const points: PricePoint[] = []

  let intervalSeconds: number
  let numPoints: number

  switch (period) {
    case 'DAY':
      intervalSeconds = 3600 // 1 hour
      numPoints = 24
      break
    case 'WEEK':
      intervalSeconds = 3600 * 4 // 4 hours
      numPoints = 42
      break
    case 'MONTH':
      intervalSeconds = 3600 * 24 // 1 day
      numPoints = 30
      break
    default:
      intervalSeconds = 3600
      numPoints = 24
  }

  for (let i = 0; i < numPoints; i++) {
    const timestamp = now - (numPoints - i - 1) * intervalSeconds
    // Small variance for realism (0.999 - 1.001)
    const price = 1 + (Math.random() - 0.5) * 0.002
    points.push({ timestamp, price })
  }

  return points
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TokenPriceHistoryResponse | { message: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` })
  }

  const { symbol, period = 'WEEK' } = req.query

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ message: 'symbol is required' })
  }

  const VALID_PERIODS = ['DAY', 'WEEK', 'MONTH'] as const
  if (!VALID_PERIODS.includes(period as HistoryPeriod)) {
    return res.status(400).json({ message: 'Invalid period. Use DAY, WEEK, or MONTH' })
  }

  const historyPeriod = period as HistoryPeriod
  const normalizedSymbol = symbol.toUpperCase()

  // Check if it's a stablecoin
  const isStablecoin = ['USDC', 'AUSDC', 'USDT', 'AUSDT', 'MUSDT'].includes(normalizedSymbol)

  const cacheKey = `token-price-history:${normalizedSymbol}:${historyPeriod}`

  try {
    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      async () => {
        if (isStablecoin) {
          return generateStablecoinHistory(historyPeriod)
        }
        return fetchCoinGeckoPriceHistory(normalizedSymbol, historyPeriod)
      }
    )

    res.setHeader('Cache-Control', 'no-store')

    return res.status(200).json({
      prices: result.data,
      symbol: normalizedSymbol,
      period: historyPeriod,
    })
  } catch (error) {
    console.error('[token-price-history] Error:', error)
    return res.status(500).json({ message: 'Failed to fetch price history' })
  }
}
