import { useMemo } from 'react'
import { Currency, Token } from '@uniswap/sdk-core'
import { PriceOrdering } from '../types'
import { tickToPrice } from '@/lib/liquidity/utils/tick-price'

interface TokenInfo {
  address: string
  symbol: string
  decimals?: number
}

interface UsePriceOrderingParams {
  chainId: number
  token0: TokenInfo
  token1: TokenInfo
  tickLower: number
  tickUpper: number
}

/**
 * Hook to compute PriceOrdering from position tick data.
 * Uses the Uniswap V4 SDK's tickToPrice to convert ticks to Price objects.
 *
 * This mirrors Uniswap's approach of using Position.token0PriceLower/Upper
 * but computes prices directly from ticks without needing a full Position object.
 */
export function usePriceOrdering({
  chainId,
  token0,
  token1,
  tickLower,
  tickUpper,
}: UsePriceOrderingParams): PriceOrdering {
  return useMemo(() => {
    // Create Currency objects from token info
    // For V4, we use Token (which extends Currency) since we're working with ERC20s
    const currency0: Currency = new Token(
      chainId,
      token0.address,
      token0.decimals ?? 18,
      token0.symbol
    )
    const currency1: Currency = new Token(
      chainId,
      token1.address,
      token1.decimals ?? 18,
      token1.symbol
    )

    // Get prices at tick boundaries using consolidated utility
    // tickToPrice(base, quote, tick) returns "quote per base"
    // So tickToPrice(currency0, currency1, tick) returns "currency1 per currency0"
    const priceLower = tickToPrice(tickLower, currency0, currency1)
    const priceUpper = tickToPrice(tickUpper, currency0, currency1)

    return {
      priceLower,
      priceUpper,
      base: currency0,
      quote: currency1,
    }
  }, [chainId, token0, token1, tickLower, tickUpper])
}
