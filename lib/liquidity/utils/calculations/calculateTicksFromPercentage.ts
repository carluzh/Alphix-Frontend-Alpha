/**
 * Calculate Ticks From Percentage
 *
 * Calculates tick bounds for a price range based on percentage deviation from current pool tick.
 * Used for preset range buttons (e.g., Full Range, Wide, Narrow).
 */

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
  // Calculate tick deltas using the Uniswap V3/V4 tick math
  // Price = 1.0001^tick, so tick = log(price) / log(1.0001)
  const lowerTickDelta = Math.round(Math.log(1 - lowerPercentage / 100) / Math.log(1.0001));
  const upperTickDelta = Math.round(Math.log(1 + upperPercentage / 100) / Math.log(1.0001));

  // Calculate raw tick bounds
  const rawLower = currentPoolTick + lowerTickDelta;
  const rawUpper = currentPoolTick + upperTickDelta;

  // Align to tick spacing (floor for lower, ceil for upper to ensure range is at least as wide as requested)
  const lower = Math.floor(rawLower / tickSpacing) * tickSpacing;
  const upper = Math.ceil(rawUpper / tickSpacing) * tickSpacing;

  return [lower, upper];
}
