/**
 * Position Range Chart Utilities
 * Adapted from Uniswap's LiquidityPositionRangeChart/utils.ts
 * @see interface/apps/web/src/components/Charts/LiquidityPositionRangeChart/utils.ts
 */

import { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core'

/**
 * Get crosshair position props as CSS style object
 */
export function getCrosshairProps(
  color: string,
  { yCoordinate, xCoordinate }: { yCoordinate: number; xCoordinate: number },
): React.CSSProperties {
  return {
    position: 'absolute',
    left: xCoordinate - 3,
    top: yCoordinate - 3,
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: color,
  }
}

export function isEffectivelyInfinity(value: number): boolean {
  return Math.abs(value) >= 1e20 || Math.abs(value) <= 1e-20
}

export function priceToNumber(price: Price<Currency, Currency> | null | undefined, defaultValue: number): number {
  const baseCurrency = price?.baseCurrency
  if (!baseCurrency) {
    return defaultValue
  }

  const sigFigs = Boolean(baseCurrency.decimals) && baseCurrency.decimals > 0 ? baseCurrency.decimals : 6

  const numPrice = Number(
    price.quote(CurrencyAmount.fromRawAmount(baseCurrency, Math.pow(10, baseCurrency.decimals))).toSignificant(sigFigs),
  )

  if (isEffectivelyInfinity(numPrice)) {
    return defaultValue
  }

  return numPrice
}
