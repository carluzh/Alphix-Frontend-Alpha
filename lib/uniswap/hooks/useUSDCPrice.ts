// useUSDCPrice - On-chain pricing via V4 Quoter
// Mirrors Uniswap's useUSDCPrice pattern using our existing quote infrastructure

import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { getStablecoin, PollingInterval, type PollingIntervalValue } from '../config'
import { useTokenPrices } from '@/hooks/useTokenPrices'

export function useUSDCPrice(
  currency?: Currency,
  pollInterval: PollingIntervalValue = PollingInterval.Fast,
): { price: Price<Currency, Currency> | undefined; isLoading: boolean } {
  const chainId = currency?.chainId
  const symbol = currency?.symbol
  const stablecoin = chainId ? getStablecoin(chainId) : undefined

  // Fetch price via unified batch pipeline (V4 Quoter + CoinGecko fallback)
  // batchQuotePrices already handles stablecoins ($1.00), hardcoded configs, and quote currencies
  const symbols = useMemo(() => (symbol ? [symbol] : []), [symbol])
  const { prices, isLoading } = useTokenPrices(symbols, { pollInterval })

  const price = useMemo(() => {
    if (!currency || !stablecoin || !symbol) return undefined

    const usdPrice = prices[symbol]
    if (!usdPrice || usdPrice <= 0) return undefined

    const numerator = Math.round(usdPrice * Math.pow(10, stablecoin.decimals))
    const denominator = Math.pow(10, currency.decimals)

    return new Price(currency, stablecoin, denominator.toString(), numerator.toString())
  }, [currency, stablecoin, symbol, prices])

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
