import { useMemo } from 'react'
import { Currency, Token } from '@uniswap/sdk-core'
import { PriceOrdering } from '../types'
import { getV4TickToPrice } from '../utils/getTickToPrice'

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

    // Get prices at tick boundaries
    // Note: token0 is quote, token1 is base (price = token0 per token1)
    const priceLower = getV4TickToPrice({
      baseCurrency: currency0,
      quoteCurrency: currency1,
      tick: tickLower,
    })

    const priceUpper = getV4TickToPrice({
      baseCurrency: currency0,
      quoteCurrency: currency1,
      tick: tickUpper,
    })

    return {
      priceLower,
      priceUpper,
      base: currency0,
      quote: currency1,
    }
  }, [chainId, token0, token1, tickLower, tickUpper])
}
