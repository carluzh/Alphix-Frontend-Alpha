// Quote-based pricing utility
// Uses backend pool metrics for token prices (no self-call deadlocks)
// Falls back to CoinGecko for major tokens (ETH, BTC)
// Redis caching to reduce API calls and prevent rate limiting

import type { NetworkMode } from '@/lib/pools-config'
import { modeForChainId } from '@/lib/network-mode'
import { CHAIN_REGISTRY } from '@/lib/chain-registry'
import { cacheService } from '@/lib/cache/CacheService'
import { priceKeys } from '@/lib/cache/redis-keys'

// Price cache TTL: 60s fresh, 5min stale (allows background refresh)
const PRICE_TTL = { fresh: 60, stale: 300 }

// Stablecoins that are always priced at $1.00
const STABLECOINS_USD = new Set(['USDC', 'USDS', 'USDT'])

// CoinGecko token ID mapping for fallback pricing
const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'WETH': 'weth',
  'cbBTC': 'coinbase-wrapped-btc',
}

function isStablecoinUSD(symbol: string | null | undefined): boolean {
  if (!symbol || typeof symbol !== 'string') return false
  const upper = symbol.toUpperCase()
  return STABLECOINS_USD.has(symbol) || STABLECOINS_USD.has(upper)
}

/**
 * Fetch price from backend pool metrics.
 * Each pool reports token0Price and token1Price in USD.
 * We find any pool containing the target symbol and read its USD price.
 * No self-call to the same server — avoids Next.js dev server deadlocks.
 */
async function fetchPriceFromPoolMetrics(
  symbol: string,
  networkMode: NetworkMode
): Promise<number> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const backendUrl = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001'
    const network = CHAIN_REGISTRY[networkMode].backendNetwork
    const url = `${backendUrl}/pools/metrics?network=${network}`
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!response.ok) return 0
    const data = await response.json()
    if (!data.success || !Array.isArray(data.pools)) return 0

    const upperSymbol = symbol.toUpperCase()
    for (const pool of data.pools) {
      const name: string = pool.name || ''
      const [sym0, sym1] = name.split('/')
      if (sym0?.toUpperCase() === upperSymbol && typeof pool.token0Price === 'number' && pool.token0Price > 0) {
        return pool.token0Price
      }
      if (sym1?.toUpperCase() === upperSymbol && typeof pool.token1Price === 'number' && pool.token1Price > 0) {
        return pool.token1Price
      }
    }
    return 0
  } catch {
    clearTimeout(timeoutId)
    return 0
  }
}

/**
 * Fetch price from CoinGecko API (fallback when quoter has insufficient liquidity)
 * Returns 0 on failure to match quoter contract
 */
async function fetchCoinGeckoFallback(symbol: string): Promise<number> {
  const coinId = COINGECKO_IDS[symbol]
  if (!coinId) return 0

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { headers: { 'Accept': 'application/json' }, signal: controller.signal }
    )
    clearTimeout(timeoutId)
    if (!response.ok) return 0
    const data = await response.json()
    const price = data[coinId]?.usd
    return typeof price === 'number' && price > 0 ? price : 0
  } catch {
    clearTimeout(timeoutId)
    return 0
  }
}

/**
 * Get token price in USD with Redis caching
 * Uses stale-while-revalidate pattern to reduce RPC calls
 * Auto-detects client/server: client uses API endpoint, server uses Redis directly
 */
export async function getQuotePrice(
  symbol: string | null | undefined,
  chainId: number = 8453,
  networkMode?: NetworkMode
): Promise<number> {
  if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') return 0
  if (isStablecoinUSD(symbol)) return 1

  // Client-side: use cached API endpoint (Redis unavailable on client)
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/prices/get-token-price?symbol=${encodeURIComponent(symbol)}&chainId=${chainId}`)
      if (!res.ok) return 0
      const data = await res.json()
      return data.price > 0 ? data.price : 0
    } catch {
      return 0
    }
  }

  // Server-side: use Redis cache with stale-while-revalidate
  const resolvedNetworkMode: NetworkMode = networkMode ?? (modeForChainId(chainId) ?? 'base')
  const cacheKey = priceKeys.token(symbol, resolvedNetworkMode)

  try {
    const cached = await cacheService.getWithStale<number>(cacheKey, PRICE_TTL)

    if (typeof cached.data === 'number' && cached.data > 0) {
      if (cached.isStale) {
        // Background refresh - fire and forget
        // Same priority as fresh fetch: CoinGecko first for known tokens, quoter for others
        const hasCgId = symbol in COINGECKO_IDS
        const refreshPrice = async () => {
          let price: number
          if (hasCgId) {
            price = await fetchCoinGeckoFallback(symbol)
            if (price === 0) price = await fetchPriceFromPoolMetrics(symbol, resolvedNetworkMode)
          } else {
            price = await fetchPriceFromPoolMetrics(symbol, resolvedNetworkMode)
            if (price === 0) price = await fetchCoinGeckoFallback(symbol)
          }
          if (price > 0) {
            cacheService.set(cacheKey, price, PRICE_TTL.stale).catch(() => {})
          }
        }
        refreshPrice().catch(() => {})
      }
      return cached.data
    }
  } catch {
    // Cache lookup failed, continue to fetch fresh
  }

  // No cache or cache miss - fetch fresh price
  // For tokens with CoinGecko IDs (ETH, BTC, etc.), prefer CoinGecko for accurate market prices
  // since our pool liquidity may cause slippage-distorted pricing via the quoter.
  // For protocol-specific tokens without CoinGecko IDs, use the on-chain quoter.
  const hasCoinGeckoId = symbol in COINGECKO_IDS
  let price: number
  if (hasCoinGeckoId) {
    price = await fetchCoinGeckoFallback(symbol)
    if (price === 0) price = await fetchPriceFromPoolMetrics(symbol, resolvedNetworkMode)
  } else {
    price = await fetchPriceFromPoolMetrics(symbol, resolvedNetworkMode)
    if (price === 0) price = await fetchCoinGeckoFallback(symbol)
  }

  if (price > 0) {
    cacheService.set(cacheKey, price, PRICE_TTL.stale).catch(() => {})
  }

  return price
}

export async function batchQuotePrices(
  symbols: string[],
  chainId: number = 8453,
  networkMode?: NetworkMode
): Promise<Record<string, number>> {
  if (!Array.isArray(symbols) || symbols.length === 0) return {}

  const uniqueSymbols = [...new Set(symbols.filter(s => s && typeof s === 'string'))]
  const prices = await Promise.all(
    uniqueSymbols.map(symbol => getQuotePrice(symbol, chainId, networkMode))
  )

  return Object.fromEntries(
    uniqueSymbols.map((symbol, i) => [symbol, prices[i]])
  )
}

// Alias for backwards compatibility
export async function getTokenPrice(symbol: string): Promise<number | null> {
  const price = await getQuotePrice(symbol)
  return price > 0 ? price : null
}
