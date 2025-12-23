/**
 * useGetRangeDisplay - Format price range for display
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/hooks/useGetRangeDisplay.ts
 * - interface/apps/web/src/hooks/useIsTickAtLimit.ts
 *
 * Provides formatted price range strings with special handling for full range positions.
 */

import { useMemo } from 'react';
import { Currency, Price } from '@uniswap/sdk-core';
import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Price ordering with base/quote currencies
 */
export interface PriceOrdering {
  priceLower?: Price<Currency, Currency>;
  priceUpper?: Price<Currency, Currency>;
  quote?: Currency;
  base?: Currency;
}

/**
 * Bound direction
 */
export enum Bound {
  LOWER = 'LOWER',
  UPPER = 'UPPER',
}

/**
 * Result from useGetRangeDisplay
 */
export interface RangeDisplayResult {
  minPrice: string;
  maxPrice: string;
  tokenASymbol?: string;
  tokenBSymbol?: string;
  isFullRange?: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate inverted price values for display.
 */
function calculateInvertedValues({
  priceLower,
  priceUpper,
  quote,
  base,
  invert,
}: {
  priceLower?: Price<Currency, Currency>;
  priceUpper?: Price<Currency, Currency>;
  quote?: Currency;
  base?: Currency;
  invert?: boolean;
}): {
  priceLower?: Price<Currency, Currency>;
  priceUpper?: Price<Currency, Currency>;
  quote?: Currency;
  base?: Currency;
} {
  return {
    priceUpper: invert ? priceLower?.invert() : priceUpper,
    priceLower: invert ? priceUpper?.invert() : priceLower,
    quote: invert ? base : quote,
    base: invert ? quote : base,
  };
}

/**
 * Format a tick price for display.
 * Shows 0 or ∞ for limit prices.
 */
function formatTickPrice({
  price,
  atLimit,
  direction,
  formatNumber,
}: {
  price?: Price<Currency, Currency>;
  atLimit: { [bound in Bound]?: boolean | undefined };
  direction: Bound;
  formatNumber: (value: string) => string;
}): string {
  if (atLimit[direction]) {
    return direction === Bound.LOWER ? '0' : '∞';
  }

  if (!price) {
    return '-';
  }

  return formatNumber(price.toSignificant(6));
}

/**
 * Default number formatter.
 */
function defaultFormatNumber(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  // Format with appropriate precision
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  }
  if (num >= 1) {
    return num.toFixed(4);
  }
  if (num >= 0.0001) {
    return num.toFixed(6);
  }
  return num.toExponential(2);
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to check if ticks are at min/max limits.
 *
 * @param tickSpacing - Pool tick spacing
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @returns Object with LOWER and UPPER boolean flags
 */
export function useIsTickAtLimit({
  tickSpacing,
  tickLower,
  tickUpper,
}: {
  tickSpacing?: number;
  tickLower?: number;
  tickUpper?: number;
}): { [bound in Bound]?: boolean | undefined } {
  return useMemo(
    () => ({
      [Bound.LOWER]:
        tickSpacing && tickLower !== undefined
          ? tickLower === nearestUsableTick(TickMath.MIN_TICK, tickSpacing)
          : undefined,
      [Bound.UPPER]:
        tickSpacing && tickUpper !== undefined
          ? tickUpper === nearestUsableTick(TickMath.MAX_TICK, tickSpacing)
          : undefined,
    }),
    [tickSpacing, tickLower, tickUpper]
  );
}

/**
 * Hook to get formatted price range display strings.
 *
 * @param priceOrdering - Price bounds and currencies
 * @param pricesInverted - Whether to show inverted prices
 * @param tickSpacing - Pool tick spacing
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @param formatNumber - Optional custom number formatter
 * @returns Formatted min/max prices and token symbols
 */
export function useGetRangeDisplay({
  priceOrdering,
  pricesInverted,
  tickSpacing,
  tickLower,
  tickUpper,
  formatNumber = defaultFormatNumber,
}: {
  priceOrdering: PriceOrdering;
  tickSpacing?: number;
  tickLower?: number;
  tickUpper?: number;
  pricesInverted: boolean;
  formatNumber?: (value: string) => string;
}): RangeDisplayResult {
  const { priceLower, priceUpper, base, quote } = useMemo(
    () =>
      calculateInvertedValues({
        ...priceOrdering,
        invert: pricesInverted,
      }),
    [priceOrdering, pricesInverted]
  );

  const isTickAtLimit = useIsTickAtLimit({ tickSpacing, tickLower, tickUpper });

  const minPrice = useMemo(
    () =>
      formatTickPrice({
        price: priceLower,
        atLimit: isTickAtLimit,
        direction: Bound.LOWER,
        formatNumber,
      }),
    [priceLower, isTickAtLimit, formatNumber]
  );

  const maxPrice = useMemo(
    () =>
      formatTickPrice({
        price: priceUpper,
        atLimit: isTickAtLimit,
        direction: Bound.UPPER,
        formatNumber,
      }),
    [priceUpper, isTickAtLimit, formatNumber]
  );

  const tokenASymbol = quote?.symbol;
  const tokenBSymbol = base?.symbol;
  const isFullRange = isTickAtLimit[Bound.LOWER] && isTickAtLimit[Bound.UPPER];

  return useMemo(
    () => ({
      minPrice,
      maxPrice,
      tokenASymbol,
      tokenBSymbol,
      isFullRange,
    }),
    [minPrice, maxPrice, tokenASymbol, tokenBSymbol, isFullRange]
  );
}

// =============================================================================
// UTILITY FUNCTIONS (Non-hook versions)
// =============================================================================

/**
 * Check if ticks are at limits (non-hook version).
 */
export function getIsTickAtLimit(
  tickSpacing: number | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined
): { [bound in Bound]?: boolean | undefined } {
  return {
    [Bound.LOWER]:
      tickSpacing && tickLower !== undefined
        ? tickLower === nearestUsableTick(TickMath.MIN_TICK, tickSpacing)
        : undefined,
    [Bound.UPPER]:
      tickSpacing && tickUpper !== undefined
        ? tickUpper === nearestUsableTick(TickMath.MAX_TICK, tickSpacing)
        : undefined,
  };
}

/**
 * Get formatted range display (non-hook version).
 */
export function getRangeDisplay({
  priceOrdering,
  pricesInverted,
  tickSpacing,
  tickLower,
  tickUpper,
  formatNumber = defaultFormatNumber,
}: {
  priceOrdering: PriceOrdering;
  tickSpacing?: number;
  tickLower?: number;
  tickUpper?: number;
  pricesInverted: boolean;
  formatNumber?: (value: string) => string;
}): RangeDisplayResult {
  const { priceLower, priceUpper, base, quote } = calculateInvertedValues({
    ...priceOrdering,
    invert: pricesInverted,
  });

  const isTickAtLimit = getIsTickAtLimit(tickSpacing, tickLower, tickUpper);

  const minPrice = formatTickPrice({
    price: priceLower,
    atLimit: isTickAtLimit,
    direction: Bound.LOWER,
    formatNumber,
  });

  const maxPrice = formatTickPrice({
    price: priceUpper,
    atLimit: isTickAtLimit,
    direction: Bound.UPPER,
    formatNumber,
  });

  return {
    minPrice,
    maxPrice,
    tokenASymbol: quote?.symbol,
    tokenBSymbol: base?.symbol,
    isFullRange: isTickAtLimit[Bound.LOWER] && isTickAtLimit[Bound.UPPER],
  };
}

/**
 * Format price range as string like "1,234.56 - 5,678.90 TOKEN per TOKEN"
 */
export function formatRangeString({
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
}: RangeDisplayResult): string {
  if (isFullRange) {
    return `Full Range (${tokenASymbol || '?'} per ${tokenBSymbol || '?'})`;
  }

  const tokens = tokenASymbol && tokenBSymbol
    ? ` ${tokenASymbol} per ${tokenBSymbol}`
    : '';

  return `${minPrice} - ${maxPrice}${tokens}`;
}

/**
 * Check if position is full range.
 */
export function isFullRangePosition(
  tickSpacing: number | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined
): boolean {
  const isTickAtLimit = getIsTickAtLimit(tickSpacing, tickLower, tickUpper);
  return Boolean(isTickAtLimit[Bound.LOWER] && isTickAtLimit[Bound.UPPER]);
}
