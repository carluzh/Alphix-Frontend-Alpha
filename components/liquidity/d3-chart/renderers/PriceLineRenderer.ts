/**
 * Price Line Renderer
 *
 * Renders the historical price line using D3.
 * Uses SVG mask to show different colors for in-range vs out-of-range portions.
 *
 * Based on Uniswap's PriceLineRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_COLORS, CHART_CLASSES, CHART_DIMENSIONS } from '../constants';
import type { ChartState, PriceDataPoint, PriceToYFn, Renderer } from '../types';

export interface PriceLineRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getPriceData: () => PriceDataPoint[];
  getPriceToY: () => PriceToYFn;
}

export function createPriceLineRenderer({
  g,
  getState,
  getPriceData,
  getPriceToY,
}: PriceLineRendererConfig): Renderer {
  // Create a group for price line elements
  const priceLineGroup = g.append('g').attr('class', CHART_CLASSES.PRICE_LINE_GROUP);

  const draw = (): void => {
    // Clear previous elements
    priceLineGroup.selectAll('*').remove();

    const state = getState();
    const priceData = getPriceData();
    const priceToY = getPriceToY();

    const { minPrice, maxPrice, dimensions } = state;

    if (priceData.length === 0) {
      return;
    }

    // Map price data for D3
    const priceDataMapped = priceData.map(d => ({
      date: new Date(d.time * 1000),
      value: d.value,
    }));

    // Create time scale for X-axis
    const dateExtent = d3.extent(priceDataMapped, d => d.date);
    const xScale = d3
      .scaleTime()
      .domain(dateExtent[0] ? dateExtent : [new Date(), new Date()])
      .range([0, dimensions.width]);

    // Line generator for price
    const line = d3
      .line<{ date: Date; value: number }>()
      .x(d => xScale(d.date))
      .y(d => priceToY({ price: d.value }))
      .curve(d3.curveMonotoneX);

    // Generate the complete line path data
    const linePathData = line(priceDataMapped);

    if (!linePathData) {
      return;
    }

    // Draw price line with conditional coloring
    if (minPrice !== undefined && maxPrice !== undefined) {
      // Create unique mask ID
      const maskId = `price-line-mask-${Math.random().toString(36).slice(2, 9)}`;

      // Calculate Y positions for mask
      const minPriceY = priceToY({ price: minPrice });
      const maxPriceY = priceToY({ price: maxPrice });

      // Create defs for mask
      const defs = priceLineGroup.append('defs');

      // Active range mask - only shows the portion within the selected range
      defs
        .append('mask')
        .attr('id', maskId)
        .append('rect')
        .attr('x', 0)
        .attr('y', Math.min(maxPriceY, minPriceY))
        .attr('width', dimensions.width)
        .attr('height', Math.abs(minPriceY - maxPriceY))
        .attr('fill', 'white');

      // Draw full grey line (base layer - out of range)
      priceLineGroup
        .append('path')
        .attr('class', `${CHART_CLASSES.PRICE_LINE} price-line-base`)
        .attr('d', linePathData)
        .attr('fill', 'none')
        .attr('stroke', CHART_COLORS.priceLineOutOfRange)
        .attr('stroke-width', 2);

      // Draw active colored line on top (masked to in-range only)
      priceLineGroup
        .append('path')
        .attr('class', `${CHART_CLASSES.PRICE_LINE} price-line-active`)
        .attr('d', linePathData)
        .attr('fill', 'none')
        .attr('stroke', CHART_COLORS.priceLineInRange)
        .attr('stroke-width', 2)
        .attr('mask', `url(#${maskId})`);
    } else {
      // No range selected: draw single grey line
      priceLineGroup
        .append('path')
        .attr('class', CHART_CLASSES.PRICE_LINE)
        .attr('d', linePathData)
        .attr('fill', 'none')
        .attr('stroke', CHART_COLORS.priceLineOutOfRange)
        .attr('stroke-width', 2);
    }

    // Draw dot at the end of the price line (last data point)
    // Matches PositionRangeChart pattern
    const lastPoint = priceDataMapped[priceDataMapped.length - 1];
    if (lastPoint) {
      const lastX = xScale(lastPoint.date);
      const lastY = priceToY({ price: lastPoint.value });
      const isInRange = minPrice !== undefined && maxPrice !== undefined &&
        lastPoint.value >= minPrice && lastPoint.value <= maxPrice;
      const dotColor = isInRange ? CHART_COLORS.priceLineInRange : CHART_COLORS.priceLineOutOfRange;

      // Outer circle (40% opacity)
      priceLineGroup
        .append('circle')
        .attr('cx', lastX)
        .attr('cy', lastY)
        .attr('r', CHART_DIMENSIONS.PRICE_DOT_RADIUS)
        .attr('fill', dotColor)
        .attr('fill-opacity', 0.4);

      // Inner circle (solid)
      priceLineGroup
        .append('circle')
        .attr('cx', lastX)
        .attr('cy', lastY)
        .attr('r', CHART_DIMENSIONS.PRICE_DOT_RADIUS / 2)
        .attr('fill', dotColor);
    }
  };

  return { draw };
}
