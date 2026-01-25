/**
 * Calculate Ticks From Percentage
 *
 * Calculates tick bounds for a price range based on percentage deviation from current pool tick.
 * Used for preset range buttons (e.g., Full Range, Wide, Narrow).
 *
 * Uses consolidated tick-price utilities for proper alignment.
 */

import { nearestUsableTick, priceToTickSimple } from '../tick-price';

/**
 * Calculates tick lower and upper bounds based on percentage range around current pool tick.
 *
 * @param lowerPercentage - The percentage below the current price for the lower bound (e.g., 3 for 3%)
 * @param upperPercentage - The percentage above the current price for the upper bound (e.g., 3 for 3%)
 * @param currentPoolTick - The current tick of the pool
 * @param tickSpacing - The tick spacing for the pool
 * @returns A tuple of [tickLower, tickUpper] aligned to the tick spacing
 *
 * @example
 * // For a +/-3% range around current tick 1000 with tick spacing 60:
 * const [lower, upper] = calculateTicksFromPercentage(3, 3, 1000, 60);
 */
export function calculateTicksFromPercentage(
  lowerPercentage: number,
  upperPercentage: number,
  currentPoolTick: number,
  tickSpacing: number
): [number, number] {
  // Calculate tick deltas using consolidated tick-price utility
  // priceToTickSimple converts price ratio to tick offset
  const lowerTickDelta = priceToTickSimple(1 - lowerPercentage / 100);
  const upperTickDelta = priceToTickSimple(1 + upperPercentage / 100);

  // Calculate raw tick bounds
  const rawLower = currentPoolTick + lowerTickDelta;
  const rawUpper = currentPoolTick + upperTickDelta;

  // Align to tick spacing using nearestUsableTick
  // For lower bound: floor to ensure range starts at or below requested price
  // For upper bound: ceil to ensure range ends at or above requested price
  const lower = nearestUsableTick(Math.floor(rawLower), tickSpacing);
  const upper = nearestUsableTick(Math.ceil(rawUpper), tickSpacing);

  return [lower, upper];
}
