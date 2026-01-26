/**
 * Consolidated Tick/Price Utilities
 *
 * Central module for ALL tick<->price conversions.
 * Uses Uniswap SDK for proper decimal handling.
 *
 * IMPORTANT: Always prefer the SDK-based functions over simple Math.pow(1.0001, tick)
 * which doesn't account for token decimal differences.
 *
 * Key formula reference:
 * - tick = log(price) / log(1.0001)
 * - price = 1.0001^tick
 *
 * But SDK-based methods properly handle:
 * - Token decimal differences (e.g., USDC 6 decimals vs ETH 18 decimals)
 * - Proper sqrtRatio calculations
 * - Edge cases at min/max ticks
 */

import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core';
import {
  nearestUsableTick,
  TickMath,
} from '@uniswap/v3-sdk';
import {
  tickToPrice as tickToPriceV4SDK,
  priceToClosestTick as priceToClosestV4Tick,
} from '@uniswap/v4-sdk';
import JSBI from 'jsbi';

// =============================================================================
// TICK TO PRICE (SDK-based - preferred)
// =============================================================================

/**
 * Convert tick to Price object using SDK (handles decimals properly)
 *
 * @param tick - The tick value
 * @param baseCurrency - Base currency (numerator in price display)
 * @param quoteCurrency - Quote currency (denominator in price display)
 * @returns Price object or undefined if invalid inputs
 */
export function tickToPrice(
  tick: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency
): Price<Currency, Currency> | undefined {
  if (!baseCurrency || !quoteCurrency) {
    return undefined;
  }

  try {
    return tickToPriceV4SDK(baseCurrency, quoteCurrency, tick);
  } catch {
    return undefined;
  }
}

/**
 * Convert tick to price number using SDK (handles decimals properly)
 *
 * @param tick - The tick value
 * @param baseCurrency - Base currency
 * @param quoteCurrency - Quote currency
 * @returns Price as number or undefined
 */
export function tickToPriceNumber(
  tick: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency
): number | undefined {
  const price = tickToPrice(tick, baseCurrency, quoteCurrency);
  if (!price) return undefined;

  try {
    return parseFloat(price.toSignificant(15));
  } catch {
    return undefined;
  }
}

/**
 * Convert tick to price string using SDK (handles decimals properly)
 *
 * @param tick - The tick value
 * @param baseCurrency - Base currency
 * @param quoteCurrency - Quote currency
 * @param significantDigits - Number of significant digits (default 8)
 * @returns Formatted price string or undefined
 */
export function tickToPriceString(
  tick: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency,
  significantDigits = 8
): string | undefined {
  const price = tickToPrice(tick, baseCurrency, quoteCurrency);
  if (!price) return undefined;

  try {
    return price.toSignificant(significantDigits);
  } catch {
    return undefined;
  }
}

// =============================================================================
// TICK TO PRICE (Simple fallback - use only when tokens unavailable)
// =============================================================================

/**
 * Simple tick to price calculation (NO decimal handling)
 *
 * WARNING: This does NOT account for token decimal differences.
 * Only use when Currency objects are not available.
 *
 * @param tick - The tick value
 * @returns Price as number (token1/token0 raw ratio)
 */
export function tickToPriceSimple(tick: number): number {
  return Math.pow(1.0001, tick);
}

/**
 * Simple tick to price string (NO decimal handling)
 *
 * WARNING: This does NOT account for token decimal differences.
 * Only use when Currency objects are not available.
 *
 * @param tick - The tick value
 * @param significantDigits - Number of significant digits (default 8)
 * @returns Formatted price string
 */
export function tickToPriceStringSimple(
  tick: number,
  significantDigits = 8
): string {
  const price = tickToPriceSimple(tick);

  // Handle edge cases
  if (!isFinite(price)) return '0';
  if (price < 1e-15 && price > 0) return price.toExponential(2);
  if (price > 1e15) return price.toExponential(2);

  // Format with appropriate precision
  if (price >= 1) {
    return price.toPrecision(significantDigits);
  } else {
    // For small numbers, find first significant digit
    const magnitude = Math.floor(Math.log10(price));
    const decimalPlaces = Math.min(-magnitude + significantDigits - 1, 20);
    return price.toFixed(decimalPlaces);
  }
}

// =============================================================================
// PRICE TO TICK
// =============================================================================

/**
 * Convert Price object to closest tick using SDK
 *
 * @param price - Price object
 * @returns Closest tick value
 */
export function priceToTick(price: Price<Currency, Currency>): number {
  return priceToClosestV4Tick(price);
}

/**
 * Convert price number to tick (simple calculation)
 *
 * Note: This is the inverse of tickToPriceSimple.
 * For precise conversions, use priceToTick with a Price object.
 *
 * @param price - Price as number
 * @returns Tick value (not aligned to tick spacing)
 */
export function priceToTickSimple(price: number): number {
  if (price <= 0) return TickMath.MIN_TICK;
  if (!isFinite(price)) return TickMath.MAX_TICK;

  const tick = Math.round(Math.log(price) / Math.log(1.0001));

  // Clamp to valid range
  return Math.max(TickMath.MIN_TICK, Math.min(TickMath.MAX_TICK, tick));
}

/**
 * Convert price number to nearest usable tick
 *
 * @param price - Price as number
 * @param tickSpacing - Tick spacing for the pool
 * @returns Nearest usable tick value
 */
export function priceToNearestUsableTick(
  price: number,
  tickSpacing: number
): number {
  const rawTick = priceToTickSimple(price);
  return nearestUsableTick(rawTick, tickSpacing);
}

/**
 * Convert a human-readable price number to tick using SDK (handles decimals properly)
 *
 * This function properly accounts for token decimal differences, unlike priceToTickSimple.
 * Use this when you have a price that users would recognize (e.g., "0.9 USDC per ETH")
 * and need to convert it to a tick.
 *
 * @param price - Human-readable price as number (quote/base, e.g., USDC per ETH)
 * @param baseCurrency - Base currency (denominator in price, e.g., ETH)
 * @param quoteCurrency - Quote currency (numerator in price, e.g., USDC)
 * @returns Tick value or undefined if conversion fails
 */
export function priceNumberToTick(
  price: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency
): number | undefined {
  if (!baseCurrency || !quoteCurrency) {
    return undefined;
  }

  if (price <= 0 || !isFinite(price)) {
    return undefined;
  }

  try {
    // Convert human-readable price to raw amounts accounting for decimals
    // Human price: quote_tokens / base_tokens (e.g., 1.5 USDC per 1 ETH)
    // Raw ratio: quote_raw / base_raw = price * (10^quote_decimals / 10^base_decimals)
    //
    // We use 1 whole base token in raw units as denominator
    // and price * 1 whole quote token in raw units as numerator
    const baseDecimals = baseCurrency.decimals;
    const quoteDecimals = quoteCurrency.decimals;

    // rawBase = 1 whole base token in smallest units
    const rawBase = BigInt(10 ** baseDecimals);

    // rawQuote = price * 1 whole quote token in smallest units
    // Use high precision intermediate step to avoid floating point issues
    const scaledPrice = Math.round(price * 1e12);
    const rawQuote = (BigInt(scaledPrice) * BigInt(10 ** quoteDecimals)) / BigInt(1e12);

    // Ensure non-zero amounts
    if (rawQuote <= BigInt(0) || rawBase <= BigInt(0)) {
      return undefined;
    }

    const quoteAmount = CurrencyAmount.fromRawAmount(
      quoteCurrency,
      JSBI.BigInt(rawQuote.toString())
    );
    const baseAmount = CurrencyAmount.fromRawAmount(
      baseCurrency,
      JSBI.BigInt(rawBase.toString())
    );

    // Create Price object: Price(baseCurrency, quoteCurrency, denominator, numerator)
    // Price represents: numerator/denominator = quote/base
    const priceObj = new Price(
      baseCurrency,
      quoteCurrency,
      baseAmount.quotient,
      quoteAmount.quotient
    );

    // Use SDK to convert price to tick
    return priceToClosestV4Tick(priceObj);
  } catch (error) {
    console.warn('[priceNumberToTick] Conversion failed:', error);
    return undefined;
  }
}

/**
 * Convert a human-readable price to the nearest usable tick (handles decimals properly)
 *
 * Combines priceNumberToTick with tick spacing alignment.
 *
 * @param price - Human-readable price as number
 * @param baseCurrency - Base currency
 * @param quoteCurrency - Quote currency
 * @param tickSpacing - Tick spacing for the pool
 * @returns Nearest usable tick value or undefined if conversion fails
 */
export function priceNumberToNearestUsableTick(
  price: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency,
  tickSpacing?: number
): number | undefined {
  const rawTick = priceNumberToTick(price, baseCurrency, quoteCurrency);
  if (rawTick === undefined) return undefined;

  if (tickSpacing) {
    return nearestUsableTick(rawTick, tickSpacing);
  }
  return rawTick;
}

// =============================================================================
// TICK UTILITIES
// =============================================================================

/**
 * Align a tick to the nearest usable tick for a given tick spacing
 *
 * @param tick - Raw tick value
 * @param tickSpacing - Tick spacing for the pool
 * @returns Nearest usable tick
 */
export function alignTickToSpacing(tick: number, tickSpacing: number): number {
  return nearestUsableTick(tick, tickSpacing);
}

/**
 * Get the minimum and maximum usable ticks for a given tick spacing
 *
 * @param tickSpacing - Tick spacing for the pool
 * @returns [minTick, maxTick] tuple
 */
export function getTickBounds(tickSpacing: number): [number, number] {
  return [
    nearestUsableTick(TickMath.MIN_TICK, tickSpacing),
    nearestUsableTick(TickMath.MAX_TICK, tickSpacing),
  ];
}

/**
 * Check if a tick is at the limit (min or max)
 *
 * @param tick - Tick to check
 * @param tickSpacing - Tick spacing for the pool
 * @returns Object with isAtMin and isAtMax booleans
 */
export function isTickAtLimit(
  tick: number,
  tickSpacing: number
): { isAtMin: boolean; isAtMax: boolean } {
  const [minTick, maxTick] = getTickBounds(tickSpacing);
  return {
    isAtMin: tick <= minTick,
    isAtMax: tick >= maxTick,
  };
}

/**
 * Check if a tick is within valid range
 *
 * @param tick - Tick to check
 * @returns true if tick is within min/max bounds
 */
export function isTickValid(tick: number): boolean {
  return tick >= TickMath.MIN_TICK && tick <= TickMath.MAX_TICK;
}

// =============================================================================
// RELATIVE PRICE CALCULATIONS
// =============================================================================

/**
 * Calculate price at a tick relative to current pool tick
 *
 * More accurate than absolute tick calculation when you have the current price.
 *
 * @param tick - Target tick
 * @param currentTick - Current pool tick
 * @param currentPrice - Current pool price
 * @returns Price at target tick
 */
export function tickToPriceRelative(
  tick: number,
  currentTick: number,
  currentPrice: number
): number {
  const priceDelta = Math.pow(1.0001, tick - currentTick);
  return currentPrice * priceDelta;
}

/**
 * Calculate price at a tick relative to current, with denomination handling
 *
 * @param tick - Target tick
 * @param currentTick - Current pool tick
 * @param currentPrice - Current pool price (in token1/token0 format)
 * @param baseToken - Token symbol for desired denomination
 * @param token0Symbol - Symbol of token0
 * @returns Price in desired denomination
 */
export function tickToPriceWithDenomination(
  tick: number,
  currentTick: number,
  currentPrice: number,
  baseToken: string,
  token0Symbol: string
): number {
  const priceInToken1PerToken0 = tickToPriceRelative(tick, currentTick, currentPrice);

  // If we want token0 denomination (token0/token1), invert
  return baseToken === token0Symbol
    ? 1 / priceInToken1PerToken0
    : priceInToken1PerToken0;
}

// =============================================================================
// SMART TICK TO PRICE (tries SDK first, falls back to simple)
// =============================================================================

/**
 * Convert tick to price string, using SDK when possible
 *
 * Tries SDK-based conversion first for proper decimal handling.
 * Falls back to simple calculation if tokens unavailable.
 *
 * @param tick - The tick value
 * @param baseCurrency - Base currency (optional)
 * @param quoteCurrency - Quote currency (optional)
 * @param significantDigits - Significant digits (default 8)
 * @returns Formatted price string
 */
export function tickToPriceSmart(
  tick: number,
  baseCurrency?: Currency,
  quoteCurrency?: Currency,
  significantDigits = 8
): string {
  // Try SDK-based first (handles decimals properly)
  if (baseCurrency && quoteCurrency) {
    const sdkResult = tickToPriceString(tick, baseCurrency, quoteCurrency, significantDigits);
    if (sdkResult) return sdkResult;
  }

  // Fallback to simple calculation
  return tickToPriceStringSimple(tick, significantDigits);
}

// =============================================================================
// RE-EXPORTS from SDK for convenience
// =============================================================================

export { TickMath, nearestUsableTick } from '@uniswap/v3-sdk';
export { priceToClosestTick as priceToClosestV4Tick } from '@uniswap/v4-sdk';
