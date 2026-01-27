/**
 * Points Campaign Formatters
 *
 * Mirrors Uniswap's formatting logic from:
 * - interface/packages/utilities/src/format/localeBased.ts (formatPercent)
 * - interface/packages/uniswap/src/features/language/formatter.ts (useLocalizedFormatter)
 *
 * IMPORTANT: Backend logic is IDENTICAL to Uniswap's implementation.
 */

/**
 * Placeholder text for null/undefined values.
 * Mirrors Uniswap's PLACEHOLDER_TEXT constant.
 */
export const PLACEHOLDER_TEXT = '-';

/**
 * Maximum decimal places for percentage formatting.
 * Mirrors Uniswap's PercentNumberDecimals type.
 */
export type PercentNumberDecimals = 1 | 2 | 3 | 4;

/**
 * Format a raw percentage value for display.
 * Mirrors Uniswap's formatPercent from localeBased.ts.
 *
 * IMPORTANT: This function expects the raw percentage value (e.g., 12.5 for 12.5%),
 * NOT the decimal form (0.125). It divides by 100 internally to use Intl.NumberFormat
 * percent style, which then multiplies back by 100 for display.
 *
 * @param rawPercentage - Raw percentage value (e.g., 12.5 for 12.5%)
 * @param locale - Locale string (default: 'en-US')
 * @param maxDecimals - Maximum decimal places (default: 2)
 * @returns Formatted percentage string (e.g., "12.5%")
 *
 * @example
 * ```typescript
 * formatPercent(12.5)  // "12.5%" (trailing zero suppressed for >= 1%)
 * formatPercent(5)     // "5%" (not "5.00%")
 * formatPercent(0.5)   // "0.50%" (small value, decimals preserved)
 * formatPercent(null)  // "0.00%"
 * formatPercent(NaN)   // "0.00%"
 * ```
 */
export function formatPercent(
  rawPercentage: number | string | null | undefined,
  locale: string = 'en-US',
  maxDecimals: PercentNumberDecimals = 2
): string {
  // Handle null/undefined - return 0.00% for missing APR values
  if (rawPercentage === null || rawPercentage === undefined) {
    return '0.00%';
  }

  // Parse to number if string - mirrors Uniswap's string handling
  const percentage =
    typeof rawPercentage === 'string'
      ? parseFloat(rawPercentage)
      : parseFloat(rawPercentage.toString());

  // Handle NaN cases - return 0.00% for invalid values
  if (isNaN(percentage)) {
    return '0.00%';
  }

  // Format using Intl.NumberFormat with percent style
  // Divides by 100 because percent style multiplies by 100
  // Mirrors Uniswap's formatNumber with NumberType.Percentage
  //
  // Uniswap pattern: suppress trailing zeros for values >= 1%
  // - Values < 1% (decimalValue < 0.01): use minimumFractionDigits = maxDecimals
  // - Values >= 1%: use minimumFractionDigits = 0 to suppress trailing zeros
  // This matches Uniswap's NoTrailingTwoDecimalsPercentages formatter rule
  const decimalValue = percentage / 100;
  const isSmallPercentage = decimalValue < 0.01; // Less than 1%

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: isSmallPercentage ? maxDecimals : 0,
    maximumFractionDigits: maxDecimals,
  }).format(decimalValue);
}

/**
 * Format APR for tooltip display.
 * Convenience wrapper that handles undefined pool APR.
 *
 * @param apr - APR value or undefined
 * @returns Formatted string (0.00% for undefined)
 */
export function formatAprForTooltip(apr: number | undefined): string {
  return apr !== undefined ? formatPercent(apr) : '0.00%';
}
