/**
 * D3 Liquidity Range Chart - Scale Utilities
 *
 * Functions for converting between price and Y coordinates.
 * Based on Uniswap's priceToY.ts and yToPrice.ts patterns.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS } from '../constants';
import type { ChartEntry, TickScale, TickAlignment, ChartDimensions } from '../types';

/**
 * Create a tick scale (ScaleBand) for liquidity data.
 * Maps tick values to Y positions on the chart.
 *
 * Uniswap pattern: Scale range is [totalHeight * zoomLevel, 0] which:
 * - Inverts Y axis (higher prices at top)
 * - Allows scrolling through more ticks than visible
 */
export function createTickScale(
  liquidityData: ChartEntry[],
  dimensions: ChartDimensions,
  zoomLevel: number = 1,
  panY: number = 0
): TickScale {
  if (liquidityData.length === 0) {
    // Return an empty scale
    return d3.scaleBand<string>()
      .domain([])
      .range([0, dimensions.height]) as TickScale;
  }

  // Calculate total height needed for all bars
  const barHeight = CHART_DIMENSIONS.LIQUIDITY_BAR_HEIGHT;
  const barSpacing = CHART_DIMENSIONS.LIQUIDITY_BAR_SPACING;
  const totalHeight = liquidityData.length * (barHeight + barSpacing);

  // Sort ticks - the domain order determines Y positioning
  // Ticks should be sorted ascending so that:
  // - First tick (lowest) -> bottom of range (totalHeight)
  // - Last tick (highest) -> top of range (0)
  const sortedData = [...liquidityData].sort((a, b) => a.tick - b.tick);
  const tickDomain = sortedData.map(d => d.tick.toString());

  // Create base scale with inverted range (highest price at top)
  const baseScale = d3.scaleBand<string>()
    .domain(tickDomain)
    .range([totalHeight * zoomLevel, 0]) // Inverted: highest tick at Y=0
    .paddingInner(0.05);

  // Create wrapper that adds pan offset
  const scaleFn = (tick: string): number | undefined => {
    const baseY = baseScale(tick);
    return baseY !== undefined ? baseY + panY : undefined;
  };

  // Create the scale object with methods
  const scale: TickScale = Object.assign(scaleFn, {
    domain: () => baseScale.domain(),
    bandwidth: () => baseScale.bandwidth(),
    range: () => baseScale.range() as [number, number],
  });

  return scale;
}

/**
 * Convert a price to Y coordinate.
 * Finds the closest tick in liquidity data and returns its Y position.
 */
export function priceToY({
  price,
  liquidityData,
  tickScale,
  tickAlignment = 'center',
}: {
  price: number;
  liquidityData: ChartEntry[];
  tickScale: TickScale;
  tickAlignment?: TickAlignment;
}): number {
  if (liquidityData.length === 0) {
    return 0;
  }

  // Find the closest tick by price
  const closest = liquidityData.reduce((prev, curr) =>
    Math.abs(curr.price0 - price) < Math.abs(prev.price0 - price) ? curr : prev
  );

  const bandY = tickScale(closest.tick.toString()) ?? 0;
  const bandwidth = tickScale.bandwidth();

  switch (tickAlignment) {
    case 'top':
      return bandY;
    case 'bottom':
      return bandY + bandwidth;
    default: // 'center'
      return bandY + bandwidth / 2;
  }
}

/**
 * Convert a Y coordinate back to price.
 * Finds the tick whose band center is closest to the Y position.
 */
export function yToPrice({
  y,
  liquidityData,
  tickScale,
}: {
  y: number;
  liquidityData: ChartEntry[];
  tickScale: TickScale;
}): number {
  if (liquidityData.length === 0) {
    return 0;
  }

  const tickValues = tickScale.domain();
  const bandwidth = tickScale.bandwidth();

  let closestTick = tickValues[0];
  let minDistance = Infinity;

  // Find the tick whose center is closest to Y
  for (const tick of tickValues) {
    const tickY = tickScale(tick) ?? 0;
    const centerY = tickY + bandwidth / 2;
    const distance = Math.abs(y - centerY);

    if (distance < minDistance) {
      minDistance = distance;
      closestTick = tick;
    }
  }

  // Find the price for this tick
  const tickData = liquidityData.find(d => d.tick.toString() === closestTick);
  return tickData ? tickData.price0 : 0;
}

/**
 * Create priceToY and yToPrice functions bound to specific data.
 */
export function createScaleFunctions(
  liquidityData: ChartEntry[],
  tickScale: TickScale
) {
  return {
    priceToY: ({ price, tickAlignment }: { price: number; tickAlignment?: TickAlignment }) =>
      priceToY({ price, liquidityData, tickScale, tickAlignment }),
    yToPrice: (y: number) =>
      yToPrice({ y, liquidityData, tickScale }),
  };
}

/**
 * Find the closest tick entry for a given price.
 */
export function findClosestTick(
  liquidityData: ChartEntry[],
  price: number
): ChartEntry | undefined {
  if (liquidityData.length === 0) {
    return undefined;
  }

  return liquidityData.reduce((prev, curr) =>
    Math.abs(curr.price0 - price) < Math.abs(prev.price0 - price) ? curr : prev
  );
}

/**
 * Get the price bounds from liquidity data.
 */
export function getPriceBounds(liquidityData: ChartEntry[]): {
  minPrice: number;
  maxPrice: number;
} {
  if (liquidityData.length === 0) {
    return { minPrice: 0, maxPrice: 1 };
  }

  const prices = liquidityData.map(d => d.price0);
  return {
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  };
}
