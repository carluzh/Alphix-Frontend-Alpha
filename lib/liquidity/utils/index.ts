/**
 * Liquidity Utilities
 *
 * Pure functions and calculations for liquidity operations.
 */

// Calculation utilities
export {
  getDependentAmountFromV4Position,
  getDependentAmount,
  isPositionInRange,
  getAddableTokens,
  PositionField,
  isInvalidPrice,
  isInvalidRange,
  isOutOfRange,
  getTickSpaceLimits,
  getTicksAtLimit,
  tryParseV4Tick,
  tryParsePrice,
  tryParseCurrencyAmount,
  getV4TickToPrice,
  getFieldsDisabled,
  createMockV4Pool,
  getV4PriceRangeInfo,
  getBaseAndQuoteCurrencies,
  type PriceRangeInput,
  getPriceDifference,
  getPriceDifferenceMessage,
  getPriceDifferenceColor,
  formatPriceDifference,
  shouldShowPriceWarning,
  comparePrices,
  isPriceWithinRange,
  getPricePositionInRange,
  convertPriceToValidTick,
  convertTickToPrice,
  getNearestUsableTick,
  calculateTicksFromPercentage,
  type PriceToTickParams,
  type TickToPriceParams,
} from './calculations'

// Validation utilities
export {
  DYNAMIC_FEE_AMOUNT,
  DEFAULT_TICK_SPACING,
  DYNAMIC_FEE_DATA,
  MAX_FEE_TIER_DECIMALS,
  BIPS_BASE,
  type FeeTierData,
  type DynamicFeeVisualization,
  type PoolTypeInfo,
  validateFeeTier,
  calculateTickSpacingFromFeeAmount,
  formatFeePercent,
  formatFeeForDisplay,
  getFeeTierKey,
  isDynamicFeeTier,
  getFeeTierTitle,
  getPoolTypeInfo,
  getDynamicFeeVisualization,
  formatDynamicFee,
  getDynamicFeeColor,
  compareFeeTiers,
  sortFeeTiersByTvl,
  sortFeeTiersByFee,
  getAlphixFeeData,
  isAlphixDynamicFee,
  createFeeDataFromPoolConfig,
  extractErrorMessage,
  isUserRejectionError,
  isNetworkError,
  categorizeError,
  type ErrorCategory,
} from './validation'

// Parsing utilities
export {
  safeParseUnits,
  parseDisplayAmount,
  cleanAmountForAPI,
  formatAmountDisplay,
  isZeroAmount,
  isValidAmount,
  amountsEqual,
} from './parsing'
