/**
 * Slippage validation utilities
 * Based on Uniswap's implementation
 */

import {
  MINIMUM_RECOMMENDED_SLIPPAGE,
  MAXIMUM_RECOMMENDED_SLIPPAGE,
  SLIPPAGE_CRITICAL_TOLERANCE,
  SlippageValidationResult,
} from './slippage-constants';

/**
 * Validates user slippage tolerance
 * @param slippage - Slippage percentage (e.g., 0.5 for 0.5%)
 * @returns Validation result
 */
export function validateUserSlippageTolerance(slippage: number): SlippageValidationResult {
  if (slippage < MINIMUM_RECOMMENDED_SLIPPAGE) {
    return SlippageValidationResult.TooLow;
  }

  if (slippage >= SLIPPAGE_CRITICAL_TOLERANCE) {
    return SlippageValidationResult.Critical;
  }

  if (slippage > MAXIMUM_RECOMMENDED_SLIPPAGE) {
    return SlippageValidationResult.TooHigh;
  }

  return SlippageValidationResult.Valid;
}

/**
 * Gets warning message for slippage validation result
 * @param result - Validation result
 * @returns Warning message or null
 */
export function getSlippageWarningMessage(result: SlippageValidationResult): string | null {
  switch (result) {
    case SlippageValidationResult.TooLow:
      return 'Your transaction may fail';
    case SlippageValidationResult.TooHigh:
      return 'Your transaction may be frontrun';
    case SlippageValidationResult.Critical:
      return 'Slippage is very high - high risk of loss';
    case SlippageValidationResult.Valid:
      return null;
    default:
      return null;
  }
}

/**
 * Checks if slippage is in critical range
 * @param slippage - Slippage percentage
 * @returns True if critical
 */
export function isSlippageCritical(slippage: number): boolean {
  return slippage >= SLIPPAGE_CRITICAL_TOLERANCE;
}

/**
 * Checks if slippage needs a warning
 * @param slippage - Slippage percentage
 * @returns True if warning needed
 */
export function shouldShowSlippageWarning(slippage: number): boolean {
  const result = validateUserSlippageTolerance(slippage);
  return result !== SlippageValidationResult.Valid;
}

/**
 * Parses slippage input string to number
 * @param value - Input string
 * @returns Parsed number or null if invalid
 */
export function parseSlippageInput(value: string): number | null {
  if (!value || value === '.') return null;

  const parsed = parseFloat(value);
  if (isNaN(parsed)) return null;

  return parsed;
}

/**
 * Formats slippage for display
 * @param slippage - Slippage number
 * @returns Formatted string with 2 decimals
 */
export function formatSlippageDisplay(slippage: number): string {
  return slippage.toFixed(2);
}
