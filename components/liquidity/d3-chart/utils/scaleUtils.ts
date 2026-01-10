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

// Convert price to Y coordinate
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

  const closest = liquidityData.reduce((prev, curr) =>
    Math.abs(curr.price0 - price) < Math.abs(prev.price0 - price) ? curr : prev
  );

  const bandY = tickScale(closest.tick.toString()) ?? 0;
  const bandwidth = tickScale.bandwidth();

  switch (tickAlignment) {
    case 'top': return bandY;
    case 'bottom': return bandY + bandwidth;
    default: return bandY + bandwidth / 2;
  }
}

// Convert Y coordinate to price
export function yToPrice({
  y,
  liquidityData,
  tickScale,
}: {
  y: number;
  liquidityData: ChartEntry[];
  tickScale: TickScale;
}): number {
  if (liquidityData.length === 0) return 0;

  const tickValues = tickScale.domain();
  const bandwidth = tickScale.bandwidth();

  let closestTick = tickValues[0];
  let minDistance = Infinity;

  for (const tick of tickValues) {
    const tickY = tickScale(tick) ?? 0;
    const centerY = tickY + bandwidth / 2;
    const distance = Math.abs(y - centerY);

    if (distance < minDistance) {
      minDistance = distance;
      closestTick = tick;
    }
  }

  const tickData = liquidityData.find(d => d.tick.toString() === closestTick);
  return tickData ? tickData.price0 : 0;
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
