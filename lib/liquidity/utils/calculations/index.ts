/**
 * Calculation Utilities
 *
 * Pure functions for liquidity calculations.
 */

export {
  getDependentAmountFromV4Position,
  getDependentAmount,
  isPositionInRange,
  getAddableTokens,
  PositionField,
} from './getDependentAmount';

export {
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
} from './priceRangeInfo';

export {
  getPriceDifference,
  getPriceDifferenceMessage,
  getPriceDifferenceColor,
  formatPriceDifference,
  shouldShowPriceWarning,
  comparePrices,
  isPriceWithinRange,
  getPricePositionInRange,
} from './getPriceDifference';

export { calculateTicksFromPercentage } from './calculateTicksFromPercentage';

// priceConversion.ts DELETED - use Uniswap SDK's tickToPrice instead
