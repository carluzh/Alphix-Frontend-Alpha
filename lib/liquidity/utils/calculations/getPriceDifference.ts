/**
 * Get Price Difference - Calculate price deviation between user input and market price
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/utils/getPriceDifference.ts
 *
 * Used to warn users when their initial price differs significantly from market price.
 */

import type { Currency, Price } from '@uniswap/sdk-core';

import type { PriceDifference, WarningSeverity } from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Price difference threshold for warning (5%)
 */
const WARNING_PRICE_DIFFERENCE_PERCENTAGE = 5;

/**
 * Price difference threshold for critical warning (10%)
 */
const CRITICAL_PRICE_DIFFERENCE_PERCENTAGE = 10;

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Calculate the price difference between user input and market price.
 *
 * Used to show warnings when users set initial prices that differ significantly
 * from the current market price when creating a new pool.
 *
 * @param initialPrice - User-entered price string
 * @param defaultInitialPrice - Market price from quote or pool
 * @param priceInverted - Whether the price display is inverted
 * @returns PriceDifference with value, absoluteValue, and warning severity
 */
export function getPriceDifference({
  initialPrice,
  defaultInitialPrice,
  priceInverted,
}: {
  initialPrice: string;
  defaultInitialPrice?: Price<Currency, Currency>;
  priceInverted: boolean;
}): PriceDifference | undefined {
  // Parse user input
  const initialPriceNumber = Number(initialPrice);

  // Get default price, inverting if necessary
  const defaultInitialPriceNumber = priceInverted
    ? Number(defaultInitialPrice?.invert().toSignificant(8))
    : Number(defaultInitialPrice?.toSignificant(8));

  // Return undefined if either price is invalid
  if (!initialPriceNumber || !defaultInitialPriceNumber || isNaN(initialPriceNumber) || isNaN(defaultInitialPriceNumber)) {
    return undefined;
  }

  // Calculate difference
  const priceDifference = initialPriceNumber - defaultInitialPriceNumber;
  const priceDifferencePercentage = (priceDifference / defaultInitialPriceNumber) * 100;
  const priceDifferencePercentageRounded = Math.round(priceDifferencePercentage);
  const priceDifferencePercentageAbsolute = Math.abs(priceDifferencePercentageRounded);

  // Determine warning severity
  let warning: WarningSeverity | undefined;
  if (priceDifferencePercentageAbsolute > CRITICAL_PRICE_DIFFERENCE_PERCENTAGE) {
    warning = 'high';
  } else if (priceDifferencePercentageAbsolute > WARNING_PRICE_DIFFERENCE_PERCENTAGE) {
    warning = 'medium';
  }

  return {
    value: priceDifferencePercentageRounded,
    absoluteValue: priceDifferencePercentageAbsolute,
    warning,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get warning message for price difference.
 */
export function getPriceDifferenceMessage(
  priceDifference: PriceDifference | undefined
): string | undefined {
  if (!priceDifference || !priceDifference.warning) {
    return undefined;
  }

  const direction = priceDifference.value > 0 ? 'higher' : 'lower';

  switch (priceDifference.warning) {
    case 'high':
      return `Your price is ${priceDifference.absoluteValue}% ${direction} than the market price. This may result in significant losses.`;
    case 'medium':
      return `Your price is ${priceDifference.absoluteValue}% ${direction} than the market price.`;
    default:
      return undefined;
  }
}

/**
 * Get color for price difference warning.
 */
export function getPriceDifferenceColor(
  warning: WarningSeverity | undefined
): 'error' | 'warning' | 'neutral' {
  switch (warning) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Format price difference for display.
 */
export function formatPriceDifference(
  priceDifference: PriceDifference | undefined
): string {
  if (!priceDifference) {
    return '';
  }

  const sign = priceDifference.value > 0 ? '+' : '';
  return `${sign}${priceDifference.value}%`;
}

/**
 * Check if price difference should show warning.
 */
export function shouldShowPriceWarning(
  priceDifference: PriceDifference | undefined
): boolean {
  return Boolean(priceDifference?.warning);
}

// =============================================================================
// PRICE COMPARISON UTILITIES
// =============================================================================

/**
 * Compare two prices and calculate percentage difference.
 *
 * @param priceA - First price
 * @param priceB - Second price
 * @returns Percentage difference (positive if A > B, negative if A < B)
 */
export function comparePrices(
  priceA: Price<Currency, Currency> | undefined,
  priceB: Price<Currency, Currency> | undefined
): number | undefined {
  if (!priceA || !priceB) {
    return undefined;
  }

  try {
    const priceANum = Number(priceA.toSignificant(8));
    const priceBNum = Number(priceB.toSignificant(8));

    if (!priceANum || !priceBNum) {
      return undefined;
    }

    return ((priceANum - priceBNum) / priceBNum) * 100;
  } catch {
    return undefined;
  }
}

/**
 * Check if current price is within a given range of prices.
 *
 * @param currentPrice - Current pool price
 * @param lowerPrice - Lower bound price
 * @param upperPrice - Upper bound price
 * @returns true if current price is within range
 */
export function isPriceWithinRange(
  currentPrice: Price<Currency, Currency> | undefined,
  lowerPrice: Price<Currency, Currency> | undefined,
  upperPrice: Price<Currency, Currency> | undefined
): boolean {
  if (!currentPrice || !lowerPrice || !upperPrice) {
    return false;
  }

  try {
    const current = Number(currentPrice.toSignificant(8));
    const lower = Number(lowerPrice.toSignificant(8));
    const upper = Number(upperPrice.toSignificant(8));

    return current >= lower && current <= upper;
  } catch {
    return false;
  }
}

/**
 * Calculate position of current price within range (0-100%).
 *
 * @param currentPrice - Current pool price
 * @param lowerPrice - Lower bound price
 * @param upperPrice - Upper bound price
 * @returns Position as percentage (0 = at lower, 100 = at upper, 50 = middle)
 */
export function getPricePositionInRange(
  currentPrice: Price<Currency, Currency> | undefined,
  lowerPrice: Price<Currency, Currency> | undefined,
  upperPrice: Price<Currency, Currency> | undefined
): number | undefined {
  if (!currentPrice || !lowerPrice || !upperPrice) {
    return undefined;
  }

  try {
    const current = Number(currentPrice.toSignificant(8));
    const lower = Number(lowerPrice.toSignificant(8));
    const upper = Number(upperPrice.toSignificant(8));

    if (upper === lower) {
      return 50;
    }

    const position = ((current - lower) / (upper - lower)) * 100;
    return Math.max(0, Math.min(100, position));
  } catch {
    return undefined;
  }
}
