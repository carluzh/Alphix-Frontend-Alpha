// useUSDCPrice - On-chain pricing via V4 Quoter
// Mirrors Uniswap's useUSDCPrice pattern using our existing quote infrastructure

import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStablecoin, PollingInterval, type PollingIntervalValue } from '../config'
import { MAINNET_CHAIN_ID } from '@/lib/network-mode'

const STABLECOIN_SYMBOLS = new Set(['usdc', 'usdt', 'dai'])

function isStablecoin(symbol?: string): boolean {
  if (!symbol) return false
  return STABLECOIN_SYMBOLS.has(symbol.toLowerCase())
}

async function fetchQuotePrice(symbol: string, chainId: number): Promise<number | null> {
  const networkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet'
  // Use USDC for mainnet, aUSDC for testnet (matching quote-prices.ts)
  const quoteToken = networkMode === 'mainnet' ? 'USDC' : 'aUSDC'

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

  const { data: usdPrice, isLoading } = useQuery({
    queryKey: ['quote-price', symbol, chainId],
    queryFn: () => fetchQuotePrice(symbol!, chainId!),
    enabled: !!symbol && !!chainId && !isStablecoin(symbol),
    refetchInterval: pollInterval,
    staleTime: pollInterval / 2,
  })

  const price = useMemo(() => {
    if (!currency || !stablecoin) return undefined

    if (isStablecoin(symbol)) {
      return new Price(currency, stablecoin, 1, 1)
    }

    if (!usdPrice || usdPrice <= 0) return undefined

    const numerator = Math.round(usdPrice * Math.pow(10, stablecoin.decimals))
    const denominator = Math.pow(10, currency.decimals)

    return new Price(currency, stablecoin, denominator.toString(), numerator.toString())
  }, [currency, stablecoin, symbol, usdPrice])

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
