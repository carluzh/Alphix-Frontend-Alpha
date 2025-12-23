/**
 * Amount Parsing Utilities
 *
 * Consolidated amount parsing functions used across liquidity operations.
 * Prevents scientific notation errors and handles edge cases.
 */

import { parseUnits, formatUnits } from 'viem';

/**
 * Safely parse amount string to bigint, handling:
 * - Scientific notation (e.g., "1e-10")
 * - Commas in numbers
 * - Empty/invalid strings
 * - "< 0.0001" display format
 *
 * @param amount - Amount string to parse
 * @param decimals - Token decimals
 * @returns Parsed bigint amount
 */
export function safeParseUnits(amount: string, decimals: number): bigint {
  // Clean the input
  let cleaned = (amount || '').toString().replace(/,/g, '').trim();

  // Handle empty or special cases
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') {
    return 0n;
  }

  // Handle scientific notation
  if (cleaned.includes('e') || cleaned.includes('E')) {
    const numericValue = parseFloat(cleaned);
    if (isNaN(numericValue) || !isFinite(numericValue)) {
      return 0n;
    }
    // Convert to fixed decimal representation
    cleaned = numericValue.toFixed(decimals);
  }

  // Parse numeric value
  const numericAmount = parseFloat(cleaned);
  if (isNaN(numericAmount) || !isFinite(numericAmount)) {
    return 0n;
  }

  // Convert to string with full decimal representation (no scientific notation)
  const fullDecimalString = numericAmount.toFixed(decimals);

  // Remove trailing zeros after decimal point for cleaner parsing
  const trimmedString = fullDecimalString.replace(/\.?0+$/, '');

  // If the result is just a decimal point, return 0
  const finalString = trimmedString === '.' || trimmedString === '' ? '0' : trimmedString;

  try {
    return parseUnits(finalString, decimals);
  } catch {
    return 0n;
  }
}

/**
 * Parse displayed token amount strings.
 * Handles formats like "< 0.0001", commas, and whitespace.
 *
 * @param value - Display amount string
 * @returns Parsed number (0 if invalid)
 */
export function parseDisplayAmount(value: string | undefined): number {
  if (!value) return 0;

  const trimmed = value.trim();

  // Handle "< X" format (approximation display)
  if (trimmed.startsWith('<')) {
    const approx = parseFloat(trimmed.replace('<', '').trim().replace(/,/g, ''));
    return Number.isFinite(approx) ? approx : 0;
  }

  // Handle regular numbers with commas
  const n = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Clean amount value before sending to API.
 * Removes ellipsis and trims whitespace.
 *
 * @param amount - Amount string to clean
 * @returns Cleaned amount string
 */
export function cleanAmountForAPI(amount: string): string {
  return amount.replace('...', '').trim();
}

/**
 * Format bigint amount to display string with proper decimals.
 *
 * @param amount - BigInt amount in wei
 * @param decimals - Token decimals
 * @param maxDisplayDecimals - Maximum decimals to show (default 6)
 * @returns Formatted string
 */
export function formatAmountDisplay(
  amount: bigint,
  decimals: number,
  maxDisplayDecimals: number = 6
): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);

  if (num === 0) return '0';

  // If very small, show "< 0.0001"
  if (num > 0 && num < 0.0001) {
    return '< 0.0001';
  }

  // Format with appropriate decimals
  const displayDecimals = Math.min(maxDisplayDecimals, decimals);

  // Remove trailing zeros
  return parseFloat(num.toFixed(displayDecimals)).toString();
}

/**
 * Check if amount string represents zero or empty value.
 *
 * @param amount - Amount string to check
 * @returns true if amount is effectively zero
 */
export function isZeroAmount(amount: string | undefined): boolean {
  if (!amount) return true;

  const cleaned = amount.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '0') return true;

  const num = parseFloat(cleaned);
  return isNaN(num) || num === 0;
}

/**
 * Validate amount string is a valid positive number.
 *
 * @param amount - Amount string to validate
 * @returns true if valid positive number
 */
export function isValidAmount(amount: string | undefined): boolean {
  if (!amount) return false;

  const cleaned = amount.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return false;

  const num = parseFloat(cleaned);
  return !isNaN(num) && isFinite(num) && num > 0;
}

/**
 * Compare two amounts (as strings) for equality within a tolerance.
 *
 * @param amount1 - First amount string
 * @param amount2 - Second amount string
 * @param toleranceBps - Tolerance in basis points (default 1 = 0.01%)
 * @returns true if amounts are equal within tolerance
 */
export function amountsEqual(
  amount1: string | undefined,
  amount2: string | undefined,
  toleranceBps: number = 1
): boolean {
  const num1 = parseDisplayAmount(amount1);
  const num2 = parseDisplayAmount(amount2);

  if (num1 === 0 && num2 === 0) return true;
  if (num1 === 0 || num2 === 0) return false;

  const diff = Math.abs(num1 - num2);
  const avg = (num1 + num2) / 2;
  const diffBps = (diff / avg) * 10000;

  return diffBps <= toleranceBps;
}
