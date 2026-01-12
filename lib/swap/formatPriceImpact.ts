/**
 * COPIED FROM UNISWAP - Imports updated for Alphix paths
 * Source: interface/packages/uniswap/src/features/transactions/swap/utils/formatPriceImpact.ts
 */
import type { Percent } from '@uniswap/sdk-core'

/** Format function type - accepts string | number, returns formatted string */
export type FormatPercentFn = (value: string | number | null | undefined) => string

export function formatPriceImpact(
  priceImpact: Percent,
  formatPercent: FormatPercentFn,
): string | undefined {
  const positiveImpactPrefix = priceImpact.lessThan(0) ? '+' : ''
  return `${positiveImpactPrefix}${formatPercent(priceImpact.multiply(-1).toFixed(3))}`
}
