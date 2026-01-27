/**
 * @deprecated This file is deprecated. Import from '@/lib/format' instead.
 *
 * This file re-exports from the new centralized formatting system for backwards compatibility.
 * New code should import directly from '@/lib/format' (which resolves to lib/format/index.ts).
 */

export {
  // Legacy functions (maintained for backwards compatibility)
  formatUSD,
  formatUSDHeader,
  formatTokenAmount,
  NUMBER_LOCALE,
  formatNumberLegacy as formatNumber,  // Export legacy as formatNumber for backwards compat
  formatPercentLegacy as formatPercent, // Export legacy as formatPercent for backwards compat

  // New Uniswap-style functions (use these for new code)
  formatNumber as formatNumberTyped,
  formatNumberOrString,
  formatCurrencyAmount,
  formatPercent as formatPercentTyped,

  // Types
  NumberType,
  type FiatNumberType,
  type PercentNumberDecimals,
  type PercentNumberType,

  // Utilities
  truncateToMaxDecimals,
  maxDecimalsReached,
  addFiatSymbolToNumber,
  getFiatCurrencyComponents,

  // APR formatting
  formatAprPercent,
} from './format/index'
