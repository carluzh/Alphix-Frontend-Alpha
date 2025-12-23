/**
 * Validation Utilities
 *
 * Fee tier, error handling, and validation utilities.
 */

export {
  // Constants
  DYNAMIC_FEE_AMOUNT,
  DEFAULT_TICK_SPACING,
  DYNAMIC_FEE_DATA,
  MAX_FEE_TIER_DECIMALS,
  BIPS_BASE,
  // Types
  type FeeTierData,
  type DynamicFeeVisualization,
  type PoolTypeInfo,
  // Validation & formatting
  validateFeeTier,
  calculateTickSpacingFromFeeAmount,
  formatFeePercent,
  formatFeeForDisplay,
  // Key generation
  getFeeTierKey,
  // Identification
  isDynamicFeeTier,
  getFeeTierTitle,
  // Pool type
  getPoolTypeInfo,
  // Dynamic fee visualization (Alphix extension)
  getDynamicFeeVisualization,
  formatDynamicFee,
  getDynamicFeeColor,
  compareFeeTiers,
  // Sorting & filtering
  sortFeeTiersByTvl,
  sortFeeTiersByFee,
  // Alphix-specific
  getAlphixFeeData,
  isAlphixDynamicFee,
  createFeeDataFromPoolConfig,
} from './feeTiers';

export {
  extractErrorMessage,
  isUserRejectionError,
  isNetworkError,
  categorizeError,
  type ErrorCategory,
} from './errorHandling';
