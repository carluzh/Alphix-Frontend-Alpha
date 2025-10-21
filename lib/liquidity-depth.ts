/**
 * Simplified liquidity depth calculation using Uniswap's canonical tick-based approach.
 * This is much simpler, faster, and more accurate than position-based aggregation.
 */

export interface TickData {
  tickIdx: string;
  liquidityNet: string;
  liquidityGross: string;
  price0: string;
  price1: string;
}

export interface LiquidityChartPoint {
  tick: number;
  price: number;
  liquidity: number; // As number for charting (converted from bigint)
}

/**
 * Calculate cumulative liquidity from tick data.
 * This is the canonical Uniswap approach - ticks store liquidityNet which represents
 * the change in active liquidity at that tick.
 *
 * @param ticks - Array of tick data from subgraph (must be sorted by tickIdx ascending)
 * @param shouldInvert - Whether to invert prices for display (e.g., ETH/USD -> USD/ETH)
 * @returns Array of chart points with tick, price, and cumulative liquidity
 */
export function calculateLiquidityDepth(
  ticks: TickData[],
  shouldInvert: boolean = false
): LiquidityChartPoint[] {
  if (!ticks || ticks.length === 0) {
    return [];
  }

  // Sort ticks by tickIdx (ascending) to ensure correct cumulative calculation
  const sortedTicks = [...ticks].sort((a, b) =>
    Number(a.tickIdx) - Number(b.tickIdx)
  );

  const chartPoints: LiquidityChartPoint[] = [];
  let cumulativeLiquidity = 0n; // Use BigInt for precision

  for (const tick of sortedTicks) {
    const tickIdx = Number(tick.tickIdx);
    const liquidityNet = BigInt(tick.liquidityNet);

    // Accumulate liquidity
    cumulativeLiquidity += liquidityNet;

    // Calculate price from tick: price = 1.0001^tick
    let price = Math.pow(1.0001, tickIdx);

    // Invert price if needed (e.g., showing USD/ETH instead of ETH/USD)
    if (shouldInvert && price !== 0) {
      price = 1 / price;
    }

    // Convert BigInt to number for charting (safe because we're displaying, not calculating)
    const liquidityNumber = Number(cumulativeLiquidity);

    chartPoints.push({
      tick: tickIdx,
      price,
      liquidity: Math.max(0, liquidityNumber) // Ensure non-negative for display
    });
  }

  return chartPoints;
}

/**
 * Filter liquidity chart points to a visible range for performance.
 * Includes a buffer zone beyond the visible range for smoother panning.
 *
 * @param chartPoints - All liquidity chart points
 * @param minTick - Minimum visible tick
 * @param maxTick - Maximum visible tick
 * @param bufferPercent - Buffer zone as percentage (default 20%)
 * @returns Filtered chart points within visible range + buffer
 */
export function filterToVisibleRange(
  chartPoints: LiquidityChartPoint[],
  minTick: number,
  maxTick: number,
  bufferPercent: number = 0.2
): LiquidityChartPoint[] {
  if (chartPoints.length === 0) return [];

  const tickRange = maxTick - minTick;
  const buffer = tickRange * bufferPercent;

  const visibleMin = minTick - buffer;
  const visibleMax = maxTick + buffer;

  return chartPoints.filter(point =>
    point.tick >= visibleMin && point.tick <= visibleMax
  );
}

/**
 * Get the maximum liquidity value from chart points for Y-axis scaling.
 *
 * @param chartPoints - Liquidity chart points
 * @param paddingPercent - Additional padding at top (default 10%)
 * @returns Maximum liquidity value with padding
 */
export function getMaxLiquidity(
  chartPoints: LiquidityChartPoint[],
  paddingPercent: number = 0.1
): number {
  if (chartPoints.length === 0) return 1;

  const maxValue = Math.max(...chartPoints.map(p => p.liquidity));
  if (maxValue === 0) return 1;

  return maxValue * (1 + paddingPercent);
}

/**
 * Calculate the active liquidity at a specific tick.
 * This walks through all ticks up to the target and accumulates liquidityNet.
 *
 * @param ticks - Array of tick data from subgraph
 * @param targetTick - The tick to calculate liquidity for
 * @returns Active liquidity at the target tick as bigint
 */
export function getLiquidityAtTick(
  ticks: TickData[],
  targetTick: number
): bigint {
  const sortedTicks = [...ticks].sort((a, b) =>
    Number(a.tickIdx) - Number(b.tickIdx)
  );

  let cumulativeLiquidity = 0n;

  for (const tick of sortedTicks) {
    const tickIdx = Number(tick.tickIdx);

    // Stop if we've passed the target tick
    if (tickIdx > targetTick) break;

    const liquidityNet = BigInt(tick.liquidityNet);
    cumulativeLiquidity += liquidityNet;
  }

  return cumulativeLiquidity;
}
