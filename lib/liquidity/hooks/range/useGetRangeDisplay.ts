/**
 * Range Utilities - Minimal SDK-based functions
 *
 * TODO: Replace with direct Uniswap SDK imports when full SDK integration is done.
 * For now, only keeping isFullRangePosition which is used by PositionCardCompact.
 */

import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';

export enum Bound {
  LOWER = 'LOWER',
  UPPER = 'UPPER',
}

/**
 * Check if ticks are at min/max limits.
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
