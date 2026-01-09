/**
 * Current Price Renderer
 *
 * Renders the current price indicator - a horizontal dotted line.
 * Following Uniswap's pattern (no dot on current price line).
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_CLASSES } from '../constants';
import type { ChartState, PriceToYFn, Renderer } from '../types';

export interface CurrentPriceRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getPriceToY: () => PriceToYFn;
}

export function createCurrentPriceRenderer({
  g,
  getState,
  getPriceToY,
}: CurrentPriceRendererConfig): Renderer {
  // Create a group for current price elements
  const currentPriceGroup = g.append('g').attr('class', CHART_CLASSES.CURRENT_PRICE_GROUP);

  const draw = (): void => {
    // Clear previous elements
    currentPriceGroup.selectAll('*').remove();

    const state = getState();
    const priceToY = getPriceToY();

    const { currentPrice, dimensions } = state;

    if (currentPrice === undefined) {
      return;
    }

    const currentY = priceToY({ price: currentPrice });

    // Draw horizontal dotted line (Uniswap pattern - no dot)
    currentPriceGroup
      .append('line')
      .attr('class', 'current-price-line')
      .attr('x1', 0)
      .attr('x2', dimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET)
      .attr('y1', currentY)
      .attr('y2', currentY)
      .attr('stroke', CHART_COLORS.currentPriceLine)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .attr('opacity', 0.5);
  };

  return { draw };
}
