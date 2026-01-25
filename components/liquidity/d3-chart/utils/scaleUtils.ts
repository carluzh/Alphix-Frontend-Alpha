/**
 * Scale utilities for converting between price and Y coordinates.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS } from '../constants';
import type { ChartEntry, TickScale, TickAlignment, ChartDimensions } from '../types';

// Creates a tick scale mapping prices to Y positions (higher prices at top)
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

  // Sort by price0 (lowest at bottom, highest at top)
  const sortedData = [...liquidityData].sort((a, b) => a.price0 - b.price0);
  const tickDomain = sortedData.map(d => d.tick.toString());

  const baseScale = d3.scaleBand<string>()
    .domain(tickDomain)
    .range([totalHeight * zoomLevel, 0])
    .paddingInner(0.05);

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

// Convert price to Y coordinate using linear interpolation
// This provides smooth positioning instead of snapping to the nearest bar
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
  if (liquidityData.length === 0) return 0;

  // Sort data by price (lowest first, highest last)
  const sortedData = [...liquidityData].sort((a, b) => a.price0 - b.price0);
  const bandwidth = tickScale.bandwidth();

  // Get price bounds
  const minPrice = sortedData[0].price0;
  const maxPrice = sortedData[sortedData.length - 1].price0;

  // Get Y bounds (note: higher prices are at lower Y values due to SVG coordinate system)
  const minPriceY = tickScale(sortedData[0].tick.toString()) ?? 0;
  const maxPriceY = tickScale(sortedData[sortedData.length - 1].tick.toString()) ?? 0;

  // Adjust Y positions based on alignment
  let minY: number;
  let maxY: number;
  switch (tickAlignment) {
    case 'top':
      minY = minPriceY;
      maxY = maxPriceY;
      break;
    case 'bottom':
      minY = minPriceY + bandwidth;
      maxY = maxPriceY + bandwidth;
      break;
    default:
      minY = minPriceY + bandwidth / 2;
      maxY = maxPriceY + bandwidth / 2;
  }

  // If min and max prices are the same, return the center position
  if (maxPrice === minPrice) {
    return minY;
  }

  // Linear interpolation: map price to Y position
  // Formula: y = minY + (maxY - minY) * (price - minPrice) / (maxPrice - minPrice)
  // Note: As price increases, Y decreases (higher prices at top of chart)
  const priceRatio = (price - minPrice) / (maxPrice - minPrice);
  const interpolatedY = minY + (maxY - minY) * priceRatio;

  return interpolatedY;
}

// Convert Y coordinate to price using linear interpolation
// This is the inverse of priceToY and provides smooth price values
export function yToPrice({
  y,
  liquidityData,
  tickScale,
}: {
  y: number;
  liquidityData: ChartEntry[];
  tickScale: TickScale;
}): number {
  // Return NaN to signal invalid data - callers should handle this
  if (liquidityData.length === 0) return NaN;

  // Sort data by price (lowest first, highest last)
  const sortedData = [...liquidityData].sort((a, b) => a.price0 - b.price0);
  const bandwidth = tickScale.bandwidth();

  // Get price bounds
  const minPrice = sortedData[0].price0;
  const maxPrice = sortedData[sortedData.length - 1].price0;

  // Validate price bounds
  if (!isFinite(minPrice) || !isFinite(maxPrice) || minPrice <= 0 || maxPrice <= 0) {
    return NaN;
  }

  // Get Y positions from scale
  const minTickY = tickScale(sortedData[0].tick.toString());
  const maxTickY = tickScale(sortedData[sortedData.length - 1].tick.toString());

  // If scale doesn't have these ticks, return NaN
  if (minTickY === undefined || maxTickY === undefined) {
    return NaN;
  }

  // Get Y bounds (center alignment)
  const minPriceY = minTickY + bandwidth / 2;
  const maxPriceY = maxTickY + bandwidth / 2;

  // If Y bounds are the same, return the center price
  if (minPriceY === maxPriceY) {
    return (minPrice + maxPrice) / 2;
  }

  // Linear interpolation: map Y position to price
  // Formula: price = minPrice + (maxPrice - minPrice) * (y - minY) / (maxY - minY)
  const yRatio = (y - minPriceY) / (maxPriceY - minPriceY);

  // Clamp yRatio to [0, 1] to prevent extrapolation beyond data bounds
  // This prevents huge values when dragging outside the chart area
  const clampedRatio = Math.max(0, Math.min(1, yRatio));
  const interpolatedPrice = minPrice + (maxPrice - minPrice) * clampedRatio;

  // Ensure positive price
  return Math.max(0.0000001, interpolatedPrice);
}

// Create bound scale functions
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

export function findClosestTick(
  liquidityData: ChartEntry[],
  price: number
): ChartEntry | undefined {
  if (liquidityData.length === 0) return undefined;

  return liquidityData.reduce((prev, curr) =>
    Math.abs(curr.price0 - price) < Math.abs(prev.price0 - price) ? curr : prev
  );
}

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
