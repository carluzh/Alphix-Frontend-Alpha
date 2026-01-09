/**
 * Min/Max Price Lines Renderer
 *
 * Renders the horizontal min and max price lines with invisible drag targets.
 * - Solid visible lines: thin, colored
 * - Transparent drag targets: thick, invisible, catch drag events
 *
 * Based on Uniswap's MinMaxPriceLineRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_CLASSES } from '../constants';
import type { ChartState, ChartActions, PriceToYFn, YToPriceFn, ChartEntry, Renderer } from '../types';
import { createHandleDragBehavior } from '../utils/dragBehaviors';

export interface MinMaxLinesRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getActions: () => ChartActions;
  getPriceToY: () => PriceToYFn;
  getYToPrice: () => YToPriceFn;
  getLiquidityData: () => ChartEntry[];
  onRangeChange: (minPrice: number, maxPrice: number) => void;
}

export function createMinMaxLinesRenderer({
  g,
  getState,
  getActions,
  getPriceToY,
  getYToPrice,
  getLiquidityData,
  onRangeChange,
}: MinMaxLinesRendererConfig): Renderer {
  // Create a group for min/max line elements
  const linesGroup = g.append('g').attr('class', CHART_CLASSES.MIN_MAX_LINES_GROUP);

  const draw = (): void => {
    // Clear previous elements
    linesGroup.selectAll('*').remove();

    const state = getState();
    const priceToY = getPriceToY();
    const yToPrice = getYToPrice();
    const liquidityData = getLiquidityData();

    const { minPrice, maxPrice, dimensions, isFullRange } = state;

    // Don't draw if no range or full range
    if (minPrice === undefined || maxPrice === undefined || isFullRange) {
      return;
    }

    const minY = priceToY({ price: minPrice, tickAlignment: 'bottom' });
    const maxY = priceToY({ price: maxPrice, tickAlignment: 'top' });

    // Create drag behaviors
    const minDragBehavior = createHandleDragBehavior({
      handleType: 'min',
      getState,
      getActions,
      priceToY,
      yToPrice,
      dimensions,
      liquidityData,
      onRangeChange,
    });

    const maxDragBehavior = createHandleDragBehavior({
      handleType: 'max',
      getState,
      getActions,
      priceToY,
      yToPrice,
      dimensions,
      liquidityData,
      onRangeChange,
    });

    const lineWidth = dimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET;

    // === MIN PRICE LINE ===
    // Solid visible line
    linesGroup
      .append('line')
      .attr('class', `price-range-element ${CHART_CLASSES.MIN_LINE}`)
      .attr('x1', 0)
      .attr('x2', lineWidth)
      .attr('y1', minY + CHART_DIMENSIONS.SOLID_LINE_HEIGHT / 2)
      .attr('y2', minY + CHART_DIMENSIONS.SOLID_LINE_HEIGHT / 2)
      .attr('stroke', CHART_COLORS.rangeActive)
      .attr('stroke-width', CHART_DIMENSIONS.SOLID_LINE_HEIGHT)
      .attr('opacity', 0.08);

    // Transparent drag target (wide invisible line)
    linesGroup
      .append('line')
      .attr('class', `price-range-element ${CHART_CLASSES.MIN_LINE}-drag`)
      .attr('x1', 0)
      .attr('x2', lineWidth)
      .attr('y1', minY)
      .attr('y2', minY)
      .attr('stroke', CHART_COLORS.rangeActive)
      .attr('stroke-width', CHART_DIMENSIONS.TRANSPARENT_LINE_HEIGHT)
      .attr('opacity', 0)
      .attr('cursor', 'ns-resize')
      .call(minDragBehavior as any);

    // === MAX PRICE LINE ===
    // Solid visible line
    linesGroup
      .append('line')
      .attr('class', `price-range-element ${CHART_CLASSES.MAX_LINE}`)
      .attr('x1', 0)
      .attr('x2', lineWidth)
      .attr('y1', maxY - CHART_DIMENSIONS.SOLID_LINE_HEIGHT / 2)
      .attr('y2', maxY - CHART_DIMENSIONS.SOLID_LINE_HEIGHT / 2)
      .attr('stroke', CHART_COLORS.rangeActive)
      .attr('stroke-width', CHART_DIMENSIONS.SOLID_LINE_HEIGHT)
      .attr('opacity', 0.08);

    // Transparent drag target (wide invisible line)
    linesGroup
      .append('line')
      .attr('class', `price-range-element ${CHART_CLASSES.MAX_LINE}-drag`)
      .attr('x1', 0)
      .attr('x2', lineWidth)
      .attr('y1', maxY)
      .attr('y2', maxY)
      .attr('stroke', CHART_COLORS.rangeActive)
      .attr('stroke-width', CHART_DIMENSIONS.TRANSPARENT_LINE_HEIGHT)
      .attr('opacity', 0)
      .attr('cursor', 'ns-resize')
      .call(maxDragBehavior as any);
  };

  return { draw };
}
