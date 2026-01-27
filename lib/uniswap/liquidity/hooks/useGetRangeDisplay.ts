import { Currency, Price } from '@uniswap/sdk-core'
import { PriceOrdering } from '../types'
import useIsTickAtLimit from './useIsTickAtLimit'
import { Bound } from '@/lib/liquidity/hooks/range'

// Simple number formatter with consistent decimal rules
// price < 10: 6 decimals (e.g., 0.999803, 1.000200)
// price >= 10: 2 decimals (e.g., 2951.88)
function formatNumberOrString(value: string): string {
  const num = parseFloat(value)
  if (!isFinite(num)) return value
  const decimals = num < 10 ? 6 : 2
  return num.toFixed(decimals)
}

function calculateInvertedValues({
  priceLower,
  priceUpper,
  quote,
  base,
  invert,
}: {
  priceLower?: Price<Currency, Currency>
  priceUpper?: Price<Currency, Currency>
  quote?: Currency
  base?: Currency
  invert?: boolean
}): {
  priceLower?: Price<Currency, Currency>
  priceUpper?: Price<Currency, Currency>
  quote?: Currency
  base?: Currency
} {
  return {
    priceUpper: invert ? priceLower?.invert() : priceUpper,
    priceLower: invert ? priceUpper?.invert() : priceLower,
    quote: invert ? base : quote,
    base: invert ? quote : base,
  }
}

function useFormatTickPrice({
  price,
  atLimit,
  direction,
}: {
  price?: Price<Currency, Currency>
  atLimit: { [bound in Bound]?: boolean | undefined }
  direction: Bound
}): string {
  if (atLimit[direction]) {
    return direction === Bound.LOWER ? '0' : '∞'
  }

  if (!price) {
    return '-'
  }

  return formatNumberOrString(price.toSignificant())
}

export function useGetRangeDisplay({
  priceOrdering,
  pricesInverted,
  tickSpacing,
  tickLower,
  tickUpper,
}: {
  priceOrdering: PriceOrdering
  tickSpacing?: number
  tickLower?: number
  tickUpper?: number
  pricesInverted: boolean
}): {
  minPrice: string
  maxPrice: string
  tokenASymbol?: string
  tokenBSymbol?: string
  isFullRange?: boolean
} {
  // Invert prices when pricesInverted=true to match chart denomination
  const { priceLower, priceUpper, base, quote } = calculateInvertedValues({
    ...priceOrdering,
    invert: pricesInverted,
  })


  const isTickAtLimit = useIsTickAtLimit({ tickSpacing, tickLower, tickUpper })

  const minPrice = useFormatTickPrice({
    price: priceLower,
    atLimit: isTickAtLimit,
    direction: Bound.LOWER,
  })
  const maxPrice = useFormatTickPrice({
    price: priceUpper,
    atLimit: isTickAtLimit,
    direction: Bound.UPPER,
  })
  const tokenASymbol = quote?.symbol
  const tokenBSymbol = base?.symbol

  return {
    minPrice,
    maxPrice,
    tokenASymbol,
    tokenBSymbol,
    isFullRange: isTickAtLimit[Bound.LOWER] && isTickAtLimit[Bound.UPPER],
  }
}
