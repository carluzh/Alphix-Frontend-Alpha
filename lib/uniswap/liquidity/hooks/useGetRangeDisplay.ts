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

/**
 * Convert Price object to number with full precision
 * Uses the same method as the working chart: parseFloat(price.toSignificant())
 */
export function priceToNumber(price: Price<Currency, Currency> | undefined, defaultValue: number): number {
  if (!price) {
    return defaultValue
  }

  try {
    // Use toSignificant() directly - same as formatNumberOrString uses for minPrice/maxPrice strings
    const numPrice = parseFloat(price.toSignificant())

    // Check for invalid values
    if (!isFinite(numPrice) || Math.abs(numPrice) >= 1e20 || Math.abs(numPrice) <= 1e-20) {
      return defaultValue
    }

    return numPrice
  } catch {
    return defaultValue
  }
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
  /** Full-precision numeric value for charts (avoids string formatting precision loss) */
  minPriceNumeric?: number
  /** Full-precision numeric value for charts (avoids string formatting precision loss) */
  maxPriceNumeric?: number
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

  // Full-precision numeric values for chart use (avoids formatNumberOrString precision loss)
  // Only provide numeric values when not at tick limits (0 or ∞)
  const minPriceNumeric = isTickAtLimit[Bound.LOWER] ? undefined : priceToNumber(priceLower, 0)
  const maxPriceNumeric = isTickAtLimit[Bound.UPPER] ? undefined : priceToNumber(priceUpper, Number.MAX_SAFE_INTEGER)

  const tokenASymbol = quote?.symbol
  const tokenBSymbol = base?.symbol

  return {
    minPrice,
    maxPrice,
    minPriceNumeric: minPriceNumeric === 0 ? undefined : minPriceNumeric,
    maxPriceNumeric: maxPriceNumeric === Number.MAX_SAFE_INTEGER ? undefined : maxPriceNumeric,
    tokenASymbol,
    tokenBSymbol,
    isFullRange: isTickAtLimit[Bound.LOWER] && isTickAtLimit[Bound.UPPER],
  }
}
