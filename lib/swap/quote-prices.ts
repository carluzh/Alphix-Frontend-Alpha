// Quote-based pricing utility
// Uses on-chain V4 Quoter for real prices from pool liquidity
// Falls back to CoinGecko when quoter has insufficient liquidity
// Redis caching to reduce RPC calls and prevent rate limiting

import type { NetworkMode } from '@/lib/pools-config'
import { MAINNET_CHAIN_ID } from '@/lib/network-mode'
import { cacheService } from '@/lib/cache/CacheService'
import { priceKeys } from '@/lib/cache/redis-keys'

// Price cache TTL: 60s fresh, 5min stale (allows background refresh)
const PRICE_TTL = { fresh: 60, stale: 300 }

// Stablecoins that are always priced at $1.00
const STABLECOINS_USD = new Set([
  'USDC', 'USDS',           // Mainnet
  'aUSDC', 'DAI',           // Mainnet (Aave-wrapped / base)
  'atUSDC', 'atDAI',        // Testnet
])

// CoinGecko token ID mapping for fallback pricing
const COINGECKO_IDS: Record<string, string> = {
  'ETH': 'ethereum',
  'atETH': 'ethereum',
  'aETH': 'ethereum',
  'WETH': 'weth',
  'BTC': 'bitcoin',
  'aBTC': 'bitcoin',
  'WBTC': 'wrapped-bitcoin',
}

function isStablecoinUSD(symbol: string | null | undefined): boolean {
  if (!symbol || typeof symbol !== 'string') return false
  const upper = symbol.toUpperCase()
  return STABLECOINS_USD.has(symbol) || STABLECOINS_USD.has(upper)
}

function getBaseUrl(): string {
  if (typeof window !== 'undefined') return ''
  return process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
}

/**
 * Fetch price from V4 Quoter (internal - no caching)
 * Returns 0 on failure (caller handles caching/fallback)
 */
async function fetchPriceFromQuoter(
  symbol: string,
  chainId: number,
  networkMode: NetworkMode
): Promise<number> {
  const quoteToken = networkMode === 'mainnet' ? 'USDC' : 'atUSDC'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const baseUrl = getBaseUrl()
    const response = await fetch(`${baseUrl}/api/swap/get-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: symbol,
        toTokenSymbol: quoteToken,
        amountDecimalsStr: '1',
        swapType: 'ExactIn',
        chainId,
        network: networkMode,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    if (!response.ok) return 0
    const data = await response.json()
    if (!data.success) return 0
    // Use midPrice (fair price from tick) instead of toAmount (execution price with slippage)
    const price = parseFloat(data.midPrice || data.toAmount)
    return Number.isFinite(price) && price > 0 ? price : 0
  } catch {
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
  const resolvedNetworkMode: NetworkMode = networkMode ?? (chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet')
  const cacheKey = priceKeys.token(symbol, resolvedNetworkMode)

  try {
    const cached = await cacheService.getWithStale<number>(cacheKey, PRICE_TTL)

    if (cached.data && cached.data > 0) {
      if (cached.isStale) {
        // Background refresh - fire and forget, with CoinGecko fallback
        fetchPriceFromQuoter(symbol, chainId, resolvedNetworkMode)
          .then(async (quoterPrice) => {
            let price = quoterPrice
            if (price === 0) price = await fetchCoinGeckoFallback(symbol)
            if (price > 0) {
              cacheService.set(cacheKey, price, PRICE_TTL.stale).catch(() => {})
            }
          })
          .catch(() => {})
      }
      return cached.data
    }
  } catch {
    // Cache lookup failed, continue to fetch fresh
  }

  // No cache or cache miss - fetch fresh from quoter, fallback to CoinGecko
  let price = await fetchPriceFromQuoter(symbol, chainId, resolvedNetworkMode)
  if (price === 0) {
    price = await fetchCoinGeckoFallback(symbol)
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
