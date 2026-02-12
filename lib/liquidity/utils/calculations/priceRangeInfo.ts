/**
 * Price Range Info - Utilities for price range calculations
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/utils/priceRangeInfo.ts
 *
 * Simplified for Alphix (V4 only).
 */

import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core';
import {
  encodeSqrtRatioX96,
  nearestUsableTick,
  TickMath,
} from '@uniswap/v3-sdk';
import { priceToClosestTick as priceToClosestV4Tick, Pool as V4Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { tickToPrice } from '../tick-price';

import type { PriceRangeInfo, PriceRangeState, FeeData } from '../../types';
import { PositionField } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface PriceRangeInput {
  /** Pool instance */
  pool?: V4Pool;
  /** Tick spacing for the pool */
  tickSpacing: number;
  /** Token0 currency */
  token0?: Currency;
  /** Token1 currency */
  token1?: Currency;
  /** User's price range state */
  priceRangeState: PriceRangeState;
  /** Fee data */
  fee?: FeeData;
  /** Hook address (for V4) */
  hook?: string;
}

// =============================================================================
// PRICE VALIDATION
// =============================================================================

/**
 * Check if a price is within valid sqrt ratio bounds.
 */
export function isInvalidPrice(price?: Price<Currency, Currency>): boolean {
  if (!price) return false;

  try {
    const sqrtRatioX96 = encodeSqrtRatioX96(price.numerator, price.denominator);
    return !(
      JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO) &&
      JSBI.lessThan(sqrtRatioX96, TickMath.MAX_SQRT_RATIO)
    );
  } catch {
    return true;
  }
}

/**
 * Check if tick range is invalid (lower >= upper).
 */
export function isInvalidRange(
  lowerTick: number | undefined,
  upperTick: number | undefined
): boolean {
  return Boolean(
    typeof lowerTick === 'number' &&
    typeof upperTick === 'number' &&
    lowerTick >= upperTick
  );
}

/**
 * Check if position is out of range based on current tick.
 */
export function isOutOfRange({
  pool,
  lowerTick,
  upperTick,
}: {
  pool?: V4Pool;
  lowerTick?: number;
  upperTick?: number;
}): boolean {
  if (!pool || typeof lowerTick !== 'number' || typeof upperTick !== 'number') {
    return false;
  }

  if (isInvalidRange(lowerTick, upperTick)) {
    return false;
  }

  const currentTick = pool.tickCurrent;
  return currentTick < lowerTick || currentTick > upperTick;
}

// =============================================================================
// TICK CALCULATIONS
// =============================================================================

/**
 * Get tick space limits for a given tick spacing.
 */
export function getTickSpaceLimits(tickSpacing: number): [number, number] {
  return [
    nearestUsableTick(TickMath.MIN_TICK, tickSpacing),
    nearestUsableTick(TickMath.MAX_TICK, tickSpacing),
  ];
}

/**
 * Check if ticks are at the limit (full range).
 */
export function getTicksAtLimit({
  lowerTick,
  upperTick,
  tickSpacing,
  priceInverted,
  fullRange,
}: {
  lowerTick?: number;
  upperTick?: number;
  tickSpacing: number;
  priceInverted: boolean;
  fullRange: boolean;
}): [boolean, boolean] {
  if (fullRange) {
    return [true, true];
  }

  const [minTick, maxTick] = getTickSpaceLimits(tickSpacing);

  return priceInverted
    ? [upperTick === maxTick, lowerTick === minTick]
    : [lowerTick === minTick, upperTick === maxTick];
}

/**
 * Parse a price string to the nearest usable tick.
 */
export function tryParseV4Tick({
  baseToken,
  quoteToken,
  value,
  tickSpacing,
}: {
  baseToken?: Currency;
  quoteToken?: Currency;
  value?: string;
  tickSpacing?: number;
}): number | undefined {
  if (!baseToken || !quoteToken || !value || !tickSpacing) {
    return undefined;
  }

  const price = tryParsePrice({ baseToken, quoteToken, value });
  if (!price) {
    return undefined;
  }

  // Check price is within min/max bounds
  const sqrtRatioX96 = encodeSqrtRatioX96(price.numerator, price.denominator);

  let tick: number;
  if (JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MAX_SQRT_RATIO)) {
    tick = TickMath.MAX_TICK;
  } else if (JSBI.lessThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO)) {
    tick = TickMath.MIN_TICK;
  } else {
    tick = priceToClosestV4Tick(price);
  }

  return nearestUsableTick(tick, tickSpacing);
}

/**
 * Try to parse a price from string input.
 */
export function tryParsePrice({
  baseToken,
  quoteToken,
  value,
}: {
  baseToken?: Currency;
  quoteToken?: Currency;
  value?: string;
}): Price<Currency, Currency> | undefined {
  if (!baseToken || !quoteToken || !value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  const parsedValue = parseFloat(trimmedValue);
  if (isNaN(parsedValue) || !isFinite(parsedValue) || parsedValue <= 0) {
    return undefined;
  }

  try {
    // Convert price to currency amounts
    const quoteAmount = tryParseCurrencyAmount(trimmedValue, quoteToken);
    const baseAmount = tryParseCurrencyAmount('1', baseToken);

    if (!quoteAmount || !baseAmount) {
      return undefined;
    }

    return new Price(
      baseAmount.currency,
      quoteAmount.currency,
      baseAmount.quotient,
      quoteAmount.quotient
    );
  } catch {
    return undefined;
  }
}

/**
 * Try to parse a currency amount from string.
 */
export function tryParseCurrencyAmount(
  value: string | undefined,
  currency: Currency | undefined
): CurrencyAmount<Currency> | undefined {
  if (!value || !currency || value === '') {
    return undefined;
  }

  try {
    const trimmedValue = value.trim();
    if (trimmedValue === '' || trimmedValue === '.') {
      return undefined;
    }

    const parsedValue = parseFloat(trimmedValue);
    if (isNaN(parsedValue) || !isFinite(parsedValue) || parsedValue < 0) {
      return undefined;
    }

    // Use full precision string conversion
    const [whole, decimal] = trimmedValue.split('.');
    const decimals = decimal?.length ?? 0;

    if (decimals > currency.decimals) {
      // Truncate to currency decimals
      const truncated = trimmedValue.slice(0, whole.length + 1 + currency.decimals);
      const scaledAmount = parseFloat(truncated) * Math.pow(10, currency.decimals);
      return CurrencyAmount.fromRawAmount(currency, Math.floor(scaledAmount).toString());
    }

    const scaledAmount = parsedValue * Math.pow(10, currency.decimals);
    return CurrencyAmount.fromRawAmount(currency, Math.floor(scaledAmount).toString());
  } catch {
    return undefined;
  }
}

// =============================================================================
// FIELD DISABLED STATE
// =============================================================================

/**
 * Determine which input fields should be disabled based on position range.
 *
 * From Uniswap V3 Tick.sol getFeeGrowthInside:
 * - In-range: tickLower <= currentTick < tickUpper (both tokens)
 * - Above range: currentTick >= tickUpper (only token1)
 * - Below range: currentTick < tickLower (only token0)
 */
export function getFieldsDisabled({
  pool,
  ticks,
}: {
  pool?: V4Pool;
  ticks?: [number | undefined, number | undefined];
}): { [PositionField.TOKEN0]: boolean; [PositionField.TOKEN1]: boolean } {
  if (!ticks || !pool) {
    return {
      [PositionField.TOKEN0]: false,
      [PositionField.TOKEN1]: false,
    };
  }

  const [tickLower, tickUpper] = ticks;

  // Above range: only token1 needed
  const deposit0Disabled = Boolean(
    typeof tickUpper === 'number' && pool.tickCurrent >= tickUpper
  );
  // Below range: only token0 needed (strict < because tickLower is inclusive)
  const deposit1Disabled = Boolean(
    typeof tickLower === 'number' && pool.tickCurrent < tickLower
  );

  return {
    [PositionField.TOKEN0]: deposit0Disabled,
    [PositionField.TOKEN1]: deposit1Disabled,
  };
}

// =============================================================================
// MOCK POOL CREATION
// =============================================================================

/**
 * Create a mock V4 pool for calculations when pool doesn't exist.
 * Used for creating new pools (not applicable in Alphix where pools are pre-deployed).
 */
export function createMockV4Pool({
  baseToken,
  quoteToken,
  fee,
  hook,
  price,
}: {
  baseToken?: Currency;
  quoteToken?: Currency;
  fee: FeeData;
  hook?: string;
  price?: Price<Currency, Currency>;
}): V4Pool | undefined {
  if (!baseToken || !quoteToken || !price) {
    return undefined;
  }

  if (isInvalidPrice(price)) {
    return undefined;
  }

  try {
    const currentTick = priceToClosestV4Tick(price);
    const currentSqrt = TickMath.getSqrtRatioAtTick(currentTick);

    return new V4Pool(
      baseToken,
      quoteToken,
      fee.feeAmount,
      fee.tickSpacing,
      hook ?? '0x0000000000000000000000000000000000000000',
      currentSqrt,
      JSBI.BigInt(0),
      currentTick
    );
  } catch {
    return undefined;
  }
}

// =============================================================================
// GET PRICE RANGE INFO - Main utility function
// =============================================================================

/**
 * Get comprehensive price range information for a V4 position.
 */
export function getV4PriceRangeInfo({
  pool,
  token0,
  token1,
  priceRangeState,
  fee,
  hook,
}: {
  pool?: V4Pool;
  token0?: Currency;
  token1?: Currency;
  priceRangeState: PriceRangeState;
  fee?: FeeData;
  hook?: string;
}): PriceRangeInfo | undefined {
  if (!fee || !token0 || !token1) {
    return undefined;
  }

  const { priceInverted, fullRange, minPrice, maxPrice } = priceRangeState;

  // Get current price from pool
  const price = pool
    ? (priceInverted ? pool.token1Price : pool.token0Price)
    : undefined;

  // Calculate tick space limits
  const tickSpacing = fee.tickSpacing;
  const [minTick, maxTick] = getTickSpaceLimits(tickSpacing);

  // Parse ticks from price inputs
  const lowerTick = fullRange || !minPrice
    ? minTick
    : priceInverted
      ? tryParseV4Tick({ baseToken: token1, quoteToken: token0, value: maxPrice, tickSpacing })
      : tryParseV4Tick({ baseToken: token0, quoteToken: token1, value: minPrice, tickSpacing });

  const upperTick = fullRange || !maxPrice
    ? maxTick
    : priceInverted
      ? tryParseV4Tick({ baseToken: token1, quoteToken: token0, value: minPrice, tickSpacing })
      : tryParseV4Tick({ baseToken: token0, quoteToken: token1, value: maxPrice, tickSpacing });

  const ticks: [number | undefined, number | undefined] = [lowerTick, upperTick];

  // Check if at limits
  const ticksAtLimit = getTicksAtLimit({
    lowerTick,
    upperTick,
    tickSpacing,
    priceInverted,
    fullRange,
  });

  // Get prices at ticks using consolidated utility
  let pricesAtTicks: [Price<Currency, Currency> | undefined, Price<Currency, Currency> | undefined] = [
    lowerTick !== undefined ? tickToPrice(lowerTick, token0, token1) : undefined,
    upperTick !== undefined ? tickToPrice(upperTick, token0, token1) : undefined,
  ];

  // Invert if needed
  if (priceInverted) {
    pricesAtTicks = [pricesAtTicks[1]?.invert(), pricesAtTicks[0]?.invert()];
  }

  // Create mock pool if needed
  const mockPool = !pool && price
    ? createMockV4Pool({ baseToken: token0, quoteToken: token1, fee, hook, price })
    : undefined;

  return {
    price,
    ticks,
    pricesAtTicks,
    ticksAtLimit,
    mockPool,
  };
}

// =============================================================================
// HELPER: Get base and quote currencies
// =============================================================================

/**
 * Get base and quote currencies based on inversion state.
 */
export function getBaseAndQuoteCurrencies(
  currencies: { [PositionField.TOKEN0]?: Currency; [PositionField.TOKEN1]?: Currency },
  priceInverted: boolean
): { baseCurrency?: Currency; quoteCurrency?: Currency } {
  const { TOKEN0, TOKEN1 } = currencies;

  return priceInverted
    ? { baseCurrency: TOKEN1, quoteCurrency: TOKEN0 }
    : { baseCurrency: TOKEN0, quoteCurrency: TOKEN1 };
}
