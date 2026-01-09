/**
 * Range Area Renderer
 *
 * Renders the selected range area background - a semi-transparent
 * rectangle between min and max prices.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_CLASSES } from '../constants';
import type { ChartState, PriceToYFn, Renderer } from '../types';

export interface RangeAreaRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getPriceToY: () => PriceToYFn;
}

export function createRangeAreaRenderer({
  g,
  getState,
  getPriceToY,
}: RangeAreaRendererConfig): Renderer {
  // Create a group for range area elements
  const rangeAreaGroup = g.append('g').attr('class', CHART_CLASSES.RANGE_AREA_GROUP);

  const draw = (): void => {
    // Clear previous elements
    rangeAreaGroup.selectAll('*').remove();

    const state = getState();
    const priceToY = getPriceToY();

    const { minPrice, maxPrice, dimensions, isFullRange } = state;

    // Only draw if both prices are set
    if (minPrice === undefined || maxPrice === undefined) {
      return;
    }

    const minY = priceToY({ price: minPrice, tickAlignment: 'bottom' });
    const maxY = priceToY({ price: maxPrice, tickAlignment: 'top' });
    const rangeHeight = minY - maxY;

    // Draw visual background that extends over liquidity area
    rangeAreaGroup
      .append('rect')
      .attr('class', 'price-range-element visual-bg')
      .attr('x', 0)
      .attr('y', maxY)
      .attr('width', dimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET)
      .attr('height', rangeHeight)
      .attr('fill', CHART_COLORS.rangeActive)
      .attr('opacity', 0.15)
      .attr('stroke', 'none')
      .style('pointer-events', 'none');

    if (isFullRange) {
      return;
    }

    // Interactive background over main chart area
    rangeAreaGroup
      .append('rect')
      .attr('class', 'price-range-element interactive-bg')
      .attr('x', 0)
      .attr('y', maxY)
      .attr('width', dimensions.width)
      .attr('height', rangeHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'move');
  };

  return { draw };
}
