// Quote-based pricing utility
// Uses on-chain V4 Quoter for real prices from pool liquidity

import type { NetworkMode } from './pools-config'
import { MAINNET_CHAIN_ID } from './network-mode'

// USDC is the quote currency, so it's always $1.00
// Other stablecoins (USDT, DAI) are quoted on-chain for accurate pricing
const QUOTE_CURRENCY = new Set(['USDC', 'AUSDC', 'aUSDC'])

function isQuoteCurrency(symbol: string | null | undefined): boolean {
  if (!symbol || typeof symbol !== 'string') return false
  return QUOTE_CURRENCY.has(symbol.toUpperCase()) || QUOTE_CURRENCY.has(symbol)
}

function getBaseUrl(): string {
  if (typeof window !== 'undefined') return ''
  return process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
}

export async function getQuotePrice(
  symbol: string | null | undefined,
  chainId: number = 8453,
  networkMode?: NetworkMode
): Promise<number> {
  if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') return 0
  if (isQuoteCurrency(symbol)) return 1

  // Derive networkMode from chainId if not explicitly provided
  const resolvedNetworkMode: NetworkMode = networkMode ?? (chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet')

  // Use USDC for mainnet, aUSDC for testnet
  const quoteToken = resolvedNetworkMode === 'mainnet' ? 'USDC' : 'aUSDC'

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
        network: resolvedNetworkMode,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    if (!response.ok) return 0
    const data = await response.json()
    if (!data.success) return 0
    // Use midPrice (fair price from tick) instead of toAmount (execution price with slippage)
    const price = parseFloat(data.midPrice || data.toAmount)
    return Number.isFinite(price) && price >= 0 ? price : 0
  } catch {
    return 0
  }
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

export function calculateTotalUSD(
  amount0: number,
  amount1: number,
  price0: number,
  price1: number
): number {
  const usd0 = isNaN(amount0 * price0) ? 0 : amount0 * price0
  const usd1 = isNaN(amount1 * price1) ? 0 : amount1 * price1
  return usd0 + usd1
}

// Alias for backwards compatibility
export async function getTokenPrice(symbol: string): Promise<number | null> {
  const price = await getQuotePrice(symbol)
  return price > 0 ? price : null
}
