/**
 * Liquidity Utilities
 *
 * Pure functions and calculations for liquidity operations.
 */

// Calculation utilities (priceConversion.ts DELETED - use Uniswap SDK)
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

// Tick/Price conversion utilities (consolidated)
export {
  // SDK-based (preferred - handles decimals properly)
  tickToPrice,
  tickToPriceNumber,
  tickToPriceString,
  priceToTick,
  // Simple fallbacks (use when tokens unavailable)
  tickToPriceSimple,
  tickToPriceStringSimple,
  priceToTickSimple,
  priceToNearestUsableTick,
  // Tick utilities
  alignTickToSpacing,
  getTickBounds,
  isTickAtLimit,
  isTickValid,
  // Relative/denomination-aware
  tickToPriceRelative,
  tickToPriceWithDenomination,
  // Smart conversion (SDK first, fallback to simple)
  tickToPriceSmart,
  // Re-exports from SDK
  TickMath,
  nearestUsableTick,
  priceToClosestV4Tick,
} from './tick-price'
