/**
 * Centralized number formatting system - adapted from Uniswap
 * @see interface/packages/utilities/src/format/
 *
 * This module provides consistent number formatting across the application.
 * All formatters use 'en-US' locale by default (commas for thousands, periods for decimals).
 */

// Re-export types
export { NumberType } from './types'
export type { PercentNumberDecimals } from './types'

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

// ============================================================================
// APR-specific formatting (returns "0.00%" for missing/invalid values)
// ============================================================================

/**
 * Format an APR percentage value with adaptive precision.
 * Returns "0.00%" for null, undefined, NaN, or zero values.
 * Uses K% notation for values >= 1000%.
 *
 * @example
 * formatAprPercent(12.345) // "12.35%"
 * formatAprPercent(0) // "0.00%"
 * formatAprPercent(null) // "0.00%"
 * formatAprPercent(1234.5) // "1.23K%"
 */
export function formatAprPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '0.00%'
  }
  if (value === 0) {
    return '0.00%'
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}K%`
  }
  if (value >= 100) {
    return `${value.toFixed(0)}%`
  }
  if (value >= 10) {
    return `${value.toFixed(1)}%`
  }
  return `${value.toFixed(2)}%`
}
