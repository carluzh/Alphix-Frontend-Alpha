/**
 * Price Conversion Utilities
 *
 * Functions for converting between prices and ticks in Uniswap V4 pools.
 * Used for price range input handling.
 */

import { TickMath, nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';

// =============================================================================
// TYPES
// =============================================================================

export interface PriceToTickParams {
  /** Price string to convert */
  priceString: string;
  /** Whether this is for the max price (affects infinity handling) */
  isMaxPrice: boolean;
  /** Base token for price denomination */
  baseToken: string;
  /** Token0 symbol */
  token0Symbol: string;
  /** Tick spacing for the pool */
  tickSpacing: number;
  /** Minimum valid tick */
  minTick: number;
  /** Maximum valid tick */
  maxTick: number;
  /** Current pool price (for reference calculation) */
  currentPrice?: string;
  /** Current pool tick (for reference calculation) */
  currentPoolTick?: number;
}

export interface TickToPriceParams {
  /** Tick to convert */
  tick: number;
  /** Current pool price (for reference calculation) */
  currentPrice: string;
  /** Current pool tick (for reference calculation) */
  currentPoolTick: number;
  /** Base token for price denomination */
  baseToken: string;
  /** Token0 symbol */
  token0Symbol: string;
}

// =============================================================================
// PRICE TO TICK CONVERSION
// =============================================================================

/**
 * Convert a price string to the nearest valid tick.
 *
 * This handles:
 * - Infinity inputs ("∞", "infinity", "infinite")
 * - Price inversion based on base token
 * - Tick spacing alignment
 * - Boundary clamping
 *
 * @param params - Conversion parameters
 * @returns Valid tick number or null if conversion fails
 */
export function convertPriceToValidTick(params: PriceToTickParams): number | null {
  const {
    priceString,
    isMaxPrice,
    baseToken,
    token0Symbol,
    tickSpacing,
    minTick,
    maxTick,
    currentPrice,
    currentPoolTick,
  } = params;

  // Normalize input
  const normalizedStr = (priceString || '').replace(/[\s,]/g, '');
  const numericPrice = parseFloat(normalizedStr);
  const isInfinityInput =
    normalizedStr.trim().toLowerCase() === '∞' ||
    normalizedStr.trim().toLowerCase() === 'infinity' ||
    normalizedStr.trim().toLowerCase() === 'infinite';

  // Handle empty or invalid input
  if (!normalizedStr.trim() || (isNaN(numericPrice) && !isInfinityInput)) {
    return null;
  }

  // Handle infinity input
  if (isInfinityInput) {
    return isMaxPrice ? maxTick : minTick;
  }

  // Handle valid numeric input
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return null;
  }

  // Need current price and pool tick as reference points
  if (!currentPrice || currentPoolTick === null || currentPoolTick === undefined) {
    return null;
  }

  const currentPriceNum = parseFloat(currentPrice);
  if (isNaN(currentPriceNum) || currentPriceNum <= 0) {
    return null;
  }

  let newTick: number;

  if (baseToken === token0Symbol) {
    // Price is denominated in token0 - we need to invert
    // Display: 1 / (currentPrice * Math.pow(1.0001, tick - currentPoolTick))
    // Solving for tick: tick = currentPoolTick + log(1 / (price * currentPrice)) / log(1.0001)
    newTick =
      currentPoolTick +
      Math.log(1 / (numericPrice * currentPriceNum)) / Math.log(1.0001);
  } else {
    // Price is denominated in token1 - direct calculation
    // Display: currentPrice * Math.pow(1.0001, tick - currentPoolTick)
    // Solving for tick: tick = currentPoolTick + log(price / currentPrice) / log(1.0001)
    newTick =
      currentPoolTick +
      Math.log(numericPrice / currentPriceNum) / Math.log(1.0001);
  }

  // Check for invalid results
  if (!isFinite(newTick) || isNaN(newTick)) {
    return null;
  }

  // Round to nearest valid tick spacing
  newTick = Math.round(newTick / tickSpacing) * tickSpacing;

  // Clamp to valid range
  newTick = Math.max(minTick, Math.min(maxTick, newTick));

  return Math.round(newTick);
}

/**
 * Convert a tick to a price string for display.
 *
 * @param params - Conversion parameters
 * @returns Price string or null if conversion fails
 */
export function convertTickToPrice(params: TickToPriceParams): string | null {
  const { tick, currentPrice, currentPoolTick, baseToken, token0Symbol } = params;

  if (currentPoolTick === null || currentPoolTick === undefined) {
    return null;
  }

  const currentPriceNum = parseFloat(currentPrice);
  if (isNaN(currentPriceNum) || currentPriceNum <= 0) {
    return null;
  }

  let price: number;

  if (baseToken === token0Symbol) {
    // Price denominated in token0 (inverted)
    price = 1 / (currentPriceNum * Math.pow(1.0001, tick - currentPoolTick));
  } else {
    // Price denominated in token1 (direct)
    price = currentPriceNum * Math.pow(1.0001, tick - currentPoolTick);
  }

  if (!isFinite(price) || isNaN(price)) {
    return null;
  }

  return price.toString();
}

// =============================================================================
// TICK UTILITIES
// =============================================================================

/**
 * Get the nearest usable tick for a given tick spacing.
 *
 * @param tick - Input tick
 * @param tickSpacing - Pool tick spacing
 * @returns Nearest usable tick
 */
export function getNearestUsableTick(tick: number, tickSpacing: number): number {
  return nearestUsableTick(tick, tickSpacing);
}

/**
 * Get the tick space limits for a given tick spacing.
 *
 * @param tickSpacing - Pool tick spacing
 * @returns [minTick, maxTick] tuple
 */
export function getTickSpaceLimits(tickSpacing: number): [number, number] {
  return [
    nearestUsableTick(TickMath.MIN_TICK, tickSpacing),
    nearestUsableTick(TickMath.MAX_TICK, tickSpacing),
  ];
}

/**
 * Check if a tick is at the minimum or maximum limit.
 *
 * @param tick - Tick to check
 * @param tickSpacing - Pool tick spacing
 * @returns [isAtMin, isAtMax] tuple
 */
export function isTickAtLimit(
  tick: number,
  tickSpacing: number
): { isAtMin: boolean; isAtMax: boolean } {
  const [minTick, maxTick] = getTickSpaceLimits(tickSpacing);
  return {
    isAtMin: tick === minTick,
    isAtMax: tick === maxTick,
  };
}

/**
 * Validate that a tick range is valid (lower < upper).
 *
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @returns true if range is valid
 */
export function isValidTickRange(tickLower: number, tickUpper: number): boolean {
  if (isNaN(tickLower) || isNaN(tickUpper)) return false;
  return tickLower < tickUpper;
}

/**
 * Calculate the percentage range around current price.
 *
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @param currentTick - Current pool tick
 * @returns Object with lower and upper percentages
 */
export function calculateRangePercentage(
  tickLower: number,
  tickUpper: number,
  currentTick: number
): { lowerPercent: number; upperPercent: number } {
  // Price = 1.0001^tick
  // Price ratio = 1.0001^(tick - currentTick)
  const lowerRatio = Math.pow(1.0001, tickLower - currentTick);
  const upperRatio = Math.pow(1.0001, tickUpper - currentTick);

  return {
    lowerPercent: (1 - lowerRatio) * 100,
    upperPercent: (upperRatio - 1) * 100,
  };
}

/**
 * Calculate ticks from percentage range around current price.
 *
 * @param lowerPercent - Lower percentage (e.g., 5 for -5%)
 * @param upperPercent - Upper percentage (e.g., 5 for +5%)
 * @param currentTick - Current pool tick
 * @param tickSpacing - Pool tick spacing
 * @returns [tickLower, tickUpper] tuple
 */
export function calculateTicksFromPercentage(
  lowerPercent: number,
  upperPercent: number,
  currentTick: number,
  tickSpacing: number
): [number, number] {
  // Price ratio for lower = 1 - lowerPercent/100
  // Price ratio for upper = 1 + upperPercent/100
  const lowerRatio = 1 - lowerPercent / 100;
  const upperRatio = 1 + upperPercent / 100;

  // tick = currentTick + log(ratio) / log(1.0001)
  let tickLower = currentTick + Math.log(lowerRatio) / Math.log(1.0001);
  let tickUpper = currentTick + Math.log(upperRatio) / Math.log(1.0001);

  // Round to tick spacing
  tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;

  return [tickLower, tickUpper];
}
