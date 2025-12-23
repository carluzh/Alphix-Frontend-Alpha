/**
 * getDependentAmount - Calculate dependent token amount for liquidity positions
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/utils/getDependentAmount.ts
 *
 * Simplified for Alphix (V4 only).
 */

import { Currency, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';

import { PositionField } from '../../types';

// Re-export for backwards compatibility
export { PositionField };

/**
 * Calculate the dependent token amount for a V4 position.
 *
 * When a user enters an amount for one token, this function calculates
 * the corresponding amount needed for the other token based on:
 * - The current pool price
 * - The position's tick range (tickLower, tickUpper)
 *
 * @param independentAmount - The amount entered by the user
 * @param pool - The V4 pool instance
 * @param tickLower - Lower tick of the position range
 * @param tickUpper - Upper tick of the position range
 * @returns The calculated dependent amount
 */
export function getDependentAmountFromV4Position({
  independentAmount,
  pool,
  tickLower,
  tickUpper,
}: {
  independentAmount: CurrencyAmount<Currency>;
  pool: V4Pool;
  tickLower: number;
  tickUpper: number;
}): CurrencyAmount<Currency> {
  const independentTokenIsFirstToken = independentAmount.currency.equals(pool.token0);

  if (independentTokenIsFirstToken) {
    return V4Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0: independentAmount.quotient,
      useFullPrecision: true,
    }).amount1;
  }

  return V4Position.fromAmount1({
    pool,
    tickLower,
    tickUpper,
    amount1: independentAmount.quotient,
  }).amount0;
}

/**
 * Generic wrapper that calculates dependent amount for any valid inputs.
 *
 * Returns undefined if:
 * - Missing required parameters
 * - Pool is not provided
 * - Tick range is invalid
 *
 * @param params - Parameters for dependent amount calculation
 * @returns The dependent amount or undefined
 */
export function getDependentAmount({
  independentAmount,
  pool,
  tickLower,
  tickUpper,
  exactField,
  token0,
  token1,
}: {
  independentAmount?: CurrencyAmount<Currency>;
  pool?: V4Pool;
  tickLower?: number;
  tickUpper?: number;
  exactField: PositionField;
  token0?: Currency;
  token1?: Currency;
}): CurrencyAmount<Currency> | undefined {
  // Validate required inputs
  if (
    !independentAmount ||
    !pool ||
    tickLower === undefined ||
    tickUpper === undefined ||
    !token0 ||
    !token1
  ) {
    return undefined;
  }

  // Validate tick range
  if (tickLower >= tickUpper) {
    return undefined;
  }

  try {
    const dependentAmount = getDependentAmountFromV4Position({
      independentAmount,
      pool,
      tickLower,
      tickUpper,
    });

    // Return the amount with the correct currency type
    const dependentToken = exactField === PositionField.TOKEN0 ? token1 : token0;
    return CurrencyAmount.fromRawAmount(dependentToken, dependentAmount.quotient);
  } catch (error) {
    // Position calculation can fail for extreme tick ranges or amounts
    console.warn('[getDependentAmount] Calculation failed:', error);
    return undefined;
  }
}

/**
 * Check if a position is in-range based on current tick.
 *
 * A position is in-range when:
 * tickLower <= currentTick < tickUpper
 *
 * @param currentTick - Current pool tick
 * @param tickLower - Lower bound of position
 * @param tickUpper - Upper bound of position
 * @returns true if position is in range
 */
export function isPositionInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick >= tickLower && currentTick < tickUpper;
}

/**
 * Determine which tokens can be added based on position range.
 *
 * - If currentTick < tickLower: position is above range, only token0 can be added
 * - If currentTick >= tickUpper: position is below range, only token1 can be added
 * - Otherwise: position is in range, both tokens can be added
 *
 * @param currentTick - Current pool tick
 * @param tickLower - Lower bound of position
 * @param tickUpper - Upper bound of position
 * @returns Object indicating which tokens can be added
 */
export function getAddableTokens(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): { canAddToken0: boolean; canAddToken1: boolean } {
  if (currentTick < tickLower) {
    // Position above current price - only token0 needed
    return { canAddToken0: true, canAddToken1: false };
  }

  if (currentTick >= tickUpper) {
    // Position below current price - only token1 needed
    return { canAddToken0: false, canAddToken1: true };
  }

  // In range - both tokens needed
  return { canAddToken0: true, canAddToken1: true };
}
