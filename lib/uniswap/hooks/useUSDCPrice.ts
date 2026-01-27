// useUSDCPrice - On-chain pricing via V4 Quoter
// Mirrors Uniswap's useUSDCPrice pattern using our existing quote infrastructure

import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStablecoin, PollingInterval, type PollingIntervalValue } from '../config'
import { MAINNET_CHAIN_ID } from '@/lib/network-mode'
import { getToken, type NetworkMode } from '@/lib/pools-config'

// USDC variants are the base quote currency, so they're always $1.00
// Other stablecoins with hardcoded usdPrice in config are also treated as stable
const QUOTE_CURRENCY_SYMBOLS = new Set(['usdc', 'ausdc', 'atusdc'])

function isQuoteCurrency(symbol?: string): boolean {
  if (!symbol) return false
  return QUOTE_CURRENCY_SYMBOLS.has(symbol.toLowerCase())
}

/**
 * Get hardcoded USD price from token config if available.
 * Used for stablecoins (USDT, DAI, etc.) that have fixed $1 prices.
 */
function getHardcodedUsdPrice(symbol: string, chainId: number): number | null {
  const networkMode: NetworkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet'
  const tokenConfig = getToken(symbol, networkMode)
  if (tokenConfig?.usdPrice) {
    return parseFloat(tokenConfig.usdPrice)
  }
  return null
}

async function fetchQuotePrice(symbol: string, chainId: number): Promise<number | null> {
  const networkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet'
  // Use USDC for mainnet, atUSDC for testnet (matching quote-prices.ts)
  const quoteToken = networkMode === 'mainnet' ? 'USDC' : 'atUSDC'

  const response = await fetch('/api/swap/get-quote', {
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
  })

  if (!response.ok) return null

  const data = await response.json()
  if (!data.success) return null

  return parseFloat(data.toAmount)
}

export function useUSDCPrice(
  currency?: Currency,
  pollInterval: PollingIntervalValue = PollingInterval.Fast,
): { price: Price<Currency, Currency> | undefined; isLoading: boolean } {
  const chainId = currency?.chainId
  const symbol = currency?.symbol
  const stablecoin = chainId ? getStablecoin(chainId) : undefined

  // Check for hardcoded price in config (for stablecoins like atUSDC, atDAI)
  const hardcodedPrice = useMemo(() => {
    if (!symbol || !chainId) return null
    return getHardcodedUsdPrice(symbol, chainId)
  }, [symbol, chainId])

  // Skip quote API if token has hardcoded price or is a quote currency
  const shouldFetchQuote = !!symbol && !!chainId && !isQuoteCurrency(symbol) && hardcodedPrice === null

  const { data: usdPrice, isLoading } = useQuery({
    queryKey: ['quote-price', symbol, chainId],
    queryFn: () => fetchQuotePrice(symbol!, chainId!),
    enabled: shouldFetchQuote,
    refetchInterval: pollInterval,
    staleTime: pollInterval / 2,
  })

  const price = useMemo(() => {
    if (!currency || !stablecoin) return undefined

    // Quote currencies (USDC variants) are always $1.00
    if (isQuoteCurrency(symbol)) {
      return new Price(currency, stablecoin, 1, 1)
    }

    // Use hardcoded price from config if available (for stablecoins)
    if (hardcodedPrice !== null && hardcodedPrice > 0) {
      const numerator = Math.round(hardcodedPrice * Math.pow(10, stablecoin.decimals))
      const denominator = Math.pow(10, currency.decimals)
      return new Price(currency, stablecoin, denominator.toString(), numerator.toString())
    }

    // Fall back to quote API price
    if (!usdPrice || usdPrice <= 0) return undefined

    const numerator = Math.round(usdPrice * Math.pow(10, stablecoin.decimals))
    const denominator = Math.pow(10, currency.decimals)

    return new Price(currency, stablecoin, denominator.toString(), numerator.toString())
  }, [currency, stablecoin, symbol, usdPrice, hardcodedPrice])

  return { price, isLoading }
}

export function useUSDCValue(
  currencyAmount: CurrencyAmount<Currency> | undefined | null,
  pollInterval: PollingIntervalValue = PollingInterval.Fast,
): CurrencyAmount<Currency> | null {
  const { price } = useUSDCPrice(currencyAmount?.currency, pollInterval)

  return useMemo(() => {
    if (!price || !currencyAmount) return null
    try {
      return price.quote(currencyAmount)
    } catch {
      return null
    }
  }, [currencyAmount, price])
}

export function useUSDCValueWithStatus(
  currencyAmount: CurrencyAmount<Currency> | undefined | null,
): { value: CurrencyAmount<Currency> | null; isLoading: boolean } {
  const { price, isLoading } = useUSDCPrice(currencyAmount?.currency)

  return useMemo(() => {
    if (!price || !currencyAmount) return { value: null, isLoading }
    try {
      return { value: price.quote(currencyAmount), isLoading }
    } catch {
      return { value: null, isLoading: false }
    }
  }, [currencyAmount, isLoading, price])
}

export function useUSDCPriceRaw(currency?: Currency): { price: number | undefined; isLoading: boolean } {
  const { price, isLoading } = useUSDCPrice(currency)

  const rawPrice = useMemo(() => {
    if (!price) return undefined
    try {
      return parseFloat(price.toSignificant(8))
    } catch {
      return undefined
    }
  }, [price])

  return { price: rawPrice, isLoading }
}
