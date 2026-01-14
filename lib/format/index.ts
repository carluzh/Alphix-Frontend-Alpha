/**
 * Centralized number formatting system - adapted from Uniswap
 * @see interface/packages/utilities/src/format/
 *
 * This module provides consistent number formatting across the application.
 * All formatters use 'en-US' locale by default (commas for thousands, periods for decimals).
 */

// Re-export types
export { NumberType } from './types'
export type { FiatNumberType, PercentNumberDecimals, PercentNumberType } from './types'

// Re-export formatter rules and creators
export {
  TYPE_TO_FORMATTER_RULES,
  TOKEN_AMOUNT_DISPLAY_FLOOR,
  type FormatCreator,
  type Format,
  type FormatterRule,
  type Formatter,
} from './localeBasedFormats'

// Re-export core formatting functions
export {
  formatNumber as formatNumberWithLocale,
  formatCurrencyAmount as formatCurrencyAmountWithLocale,
  formatNumberOrString as formatNumberOrStringWithLocale,
  formatPercent as formatPercentWithLocale,
  addFiatSymbolToNumber,
  getFiatCurrencyComponents,
  getPercentNumberType,
  type FiatCurrencyComponents,
} from './localeBased'

// Re-export utilities
export { truncateToMaxDecimals, maxDecimalsReached } from './truncateToMaxDecimals'

// ============================================================================
// Convenience functions with en-US locale (recommended for most use cases)
// ============================================================================

import { NumberType, PercentNumberDecimals } from './types'
import {
  formatNumber as _formatNumber,
  formatCurrencyAmount as _formatCurrencyAmount,
  formatNumberOrString as _formatNumberOrString,
  formatPercent as _formatPercent,
} from './localeBased'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'

const DEFAULT_LOCALE = 'en-US'
const DEFAULT_CURRENCY = 'USD'

/**
 * Format a number based on its type and magnitude.
 * Uses intelligent rules to determine decimal places and abbreviations.
 *
 * @example
 * formatNumber(1234.56, NumberType.FiatTokenPrice) // "$1,234.56"
 * formatNumber(1234567, NumberType.FiatTokenStats) // "$1.2M"
 * formatNumber(0.00001234, NumberType.TokenTx) // "<0.00001"
 */
export function formatNumber(
  input: number | null | undefined,
  type: NumberType = NumberType.FiatTokenPrice,
  options?: { currencyCode?: string; placeholder?: string }
): string {
  return _formatNumber({
    input,
    locale: DEFAULT_LOCALE,
    currencyCode: options?.currencyCode ?? DEFAULT_CURRENCY,
    type,
    placeholder: options?.placeholder,
  })
}

/**
 * Format a CurrencyAmount from @uniswap/sdk-core.
 *
 * @example
 * formatCurrencyAmount(amount, NumberType.TokenTx) // "1,234.56"
 */
export function formatCurrencyAmount(
  amount: CurrencyAmount<Currency> | null | undefined,
  type: NumberType = NumberType.TokenNonTx,
  placeholder?: string
): string {
  return _formatCurrencyAmount({
    amount,
    locale: DEFAULT_LOCALE,
    type,
    placeholder,
  })
}

/**
 * Format a number or string value based on type.
 * Handles both number and string inputs.
 *
 * @example
 * formatNumberOrString("1234.56", NumberType.FiatTokenPrice) // "$1,234.56"
 * formatNumberOrString(1234.56, NumberType.FiatTokenPrice) // "$1,234.56"
 */
export function formatNumberOrString(
  price: number | string | null | undefined,
  type: NumberType,
  options?: { currencyCode?: string; placeholder?: string }
): string {
  return _formatNumberOrString({
    price,
    locale: DEFAULT_LOCALE,
    currencyCode: options?.currencyCode ?? DEFAULT_CURRENCY,
    type,
    placeholder: options?.placeholder,
  })
}

/**
 * Format a percentage value.
 * Input should be the raw percentage (e.g., 12.5 for 12.5%).
 *
 * @example
 * formatPercent(12.5) // "12.5%"
 * formatPercent(0.5) // "0.5%"
 * formatPercent(12.5, 1) // "12.5%"
 */
export function formatPercent(
  rawPercentage: number | string | null | undefined,
  maxDecimals: PercentNumberDecimals = 2
): string {
  return _formatPercent({
    rawPercentage,
    locale: DEFAULT_LOCALE,
    maxDecimals,
  })
}

// ============================================================================
// Legacy compatibility functions (matching old lib/format.ts API exactly)
// These use direct Intl.NumberFormat to match the old behavior precisely.
// ============================================================================

/**
 * Format a USD value with standard currency formatting.
 * @deprecated Use formatNumber with NumberType.FiatTokenPrice instead
 */
export function formatUSD(
  value: number,
  opts?: { min?: number; max?: number; compact?: boolean }
): string {
  if (!Number.isFinite(value)) return '$0.00'
  if (opts?.compact) {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      notation: 'compact',
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }
  const min = opts?.min ?? (Math.abs(value) >= 100_000 ? 0 : 2)
  const max = opts?.max ?? (Math.abs(value) >= 100_000 ? 0 : 2)
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value)
}

/**
 * Format USD for headers (large display values).
 * @deprecated Use formatNumber with NumberType.PortfolioBalance instead
 */
export function formatUSDHeader(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  const min = Math.abs(value) >= 100_000 ? 0 : 2
  const max = Math.abs(value) >= 100_000 ? 0 : 2
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value)
}

/**
 * Format a plain number (no currency symbol).
 * Legacy function matching the old API signature.
 */
export function formatNumberLegacy(
  value: number,
  opts?: { min?: number; max?: number }
): string {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: opts?.min ?? 0,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value)
}

/**
 * Format a percent value (expects raw percentage like 12.5 for 12.5%).
 * Legacy function matching the old API signature.
 */
export function formatPercentLegacy(
  value: number,
  opts?: { min?: number; max?: number }
): string {
  if (!Number.isFinite(value)) return '0%'
  const s = new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: opts?.min ?? 2,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value)
  return `${s}%`
}

/**
 * Format a token amount with appropriate precision.
 * @deprecated Use formatNumber with NumberType.TokenNonTx or TokenTx instead
 */
export function formatTokenAmount(value: number, displayDecimals = 6): string {
  if (!Number.isFinite(value)) return '0'

  const threshold = Math.pow(10, -displayDecimals)
  if (value > 0 && value < threshold) {
    return `<${threshold.toLocaleString(DEFAULT_LOCALE)}`
  }

  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  }).format(value)
}

// Export the default locale for reference
export const NUMBER_LOCALE = DEFAULT_LOCALE
