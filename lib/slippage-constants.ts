/**
 * Slippage tolerance constants
 * Based on Uniswap's implementation
 */

// Auto-slippage bounds
export const MIN_AUTO_SLIPPAGE_TOLERANCE = 0.5;       // 0.5%
export const MAX_AUTO_SLIPPAGE_TOLERANCE = 5.5;       // 5.5%

// Custom slippage bounds
export const MAX_CUSTOM_SLIPPAGE_TOLERANCE = 100;     // 100%

// Warning threshold
export const SLIPPAGE_CRITICAL_TOLERANCE = 20;        // 20%

// Recommended slippage range
export const MINIMUM_RECOMMENDED_SLIPPAGE = 0.05;     // 0.05%
export const MAXIMUM_RECOMMENDED_SLIPPAGE = 1;        // 1%

// Slippage increment for +/- buttons
export const SLIPPAGE_INCREMENT = 0.1;                // 0.1%

// Default slippage for different contexts
export const DEFAULT_SWAP_SLIPPAGE = 0.5;             // 0.5%
export const DEFAULT_LP_SLIPPAGE = 2.5;               // 2.5%
export const DEFAULT_V4_NATIVE_LP_SLIPPAGE = 0.05;    // 0.05%

// Slippage validation result
export enum SlippageValidationResult {
  TooLow = 0,
  TooHigh = 1,
  Valid = 2,
  Critical = 3,
}

// Auto-slippage enum
export enum SlippageTolerance {
  Auto = 'auto',
}

// Storage keys
export const SLIPPAGE_STORAGE_KEY = 'alphix_user_slippage_tolerance';
export const SLIPPAGE_AUTO_FLAG_KEY = 'alphix_slippage_is_auto';
