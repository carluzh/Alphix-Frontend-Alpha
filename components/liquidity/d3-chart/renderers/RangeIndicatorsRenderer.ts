/**
 * Range Indicators Renderer
 *
 * Renders the sidebar range indicator with drag handles:
 * - Orange/accent colored bar showing selected range
 * - Min handle (circle at bottom)
 * - Max handle (circle at top)
 * - Center handle (rectangle in middle for moving entire range)
 *
 * Based on Uniswap's MinMaxPriceIndicatorsRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_CLASSES } from '../constants';
import type { ChartState, ChartActions, PriceToYFn, YToPriceFn, ChartEntry, Renderer } from '../types';
import { createHandleDragBehavior, createCenterDragBehavior } from '../utils/dragBehaviors';

export interface RangeIndicatorsRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getActions: () => ChartActions;
  getPriceToY: () => PriceToYFn;
  getYToPrice: () => YToPriceFn;
  getLiquidityData: () => ChartEntry[];
  onRangeChange: (minPrice: number, maxPrice: number) => void;
  /** When true, disables all drag interactions */
  viewOnly?: boolean;
}

export function createRangeIndicatorsRenderer({
  g,
  getState,
  getActions,
  getPriceToY,
  getYToPrice,
  getLiquidityData,
  onRangeChange,
  viewOnly = false,
}: RangeIndicatorsRendererConfig): Renderer {
  // Create a group for range indicator elements
  const indicatorsGroup = g.append('g').attr('class', CHART_CLASSES.RANGE_INDICATORS_GROUP);

  const draw = (): void => {
    // Clear previous elements
    indicatorsGroup.selectAll('*').remove();

    const state = getState();
    const priceToY = getPriceToY();
    const yToPrice = getYToPrice();
    const liquidityData = getLiquidityData();

    const { minPrice, maxPrice, dimensions, isFullRange } = state;

    // Calculate sidebar position
    const sidebarX = dimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET;
    const indicatorCenterX = sidebarX + CHART_DIMENSIONS.RANGE_INDICATOR_WIDTH / 2;

    // Draw the full-height background bar first (always visible)
    indicatorsGroup
      .append('rect')
      .attr('class', `${CHART_CLASSES.RANGE_INDICATOR}-background`)
      .attr('x', sidebarX)
      .attr('y', 0)
      .attr('width', CHART_DIMENSIONS.RANGE_INDICATOR_WIDTH)
      .attr('height', dimensions.height)
      .attr('fill', CHART_COLORS.rangeActive)
      .attr('opacity', 0.15)
      .attr('rx', 4)
      .attr('ry', 4);

    // If no range or full range, just show the background
    if (minPrice === undefined || maxPrice === undefined) {
      return;
    }

    // For full range, show the full bar highlighted
    if (isFullRange) {
      indicatorsGroup
        .selectAll(`.${CHART_CLASSES.RANGE_INDICATOR}-background`)
        .attr('opacity', 0.5);
      return;
    }

    // Calculate range positions
    const minY = priceToY({ price: minPrice, tickAlignment: 'bottom' });
    const maxY = priceToY({ price: maxPrice, tickAlignment: 'top' });
    const indicatorHeight = minY - maxY;

    // Ensure minimum height for visual indicator
    const constrainedHeight = Math.max(indicatorHeight, CHART_DIMENSIONS.RANGE_MIN_HEIGHT);
    const heightDiff = constrainedHeight - indicatorHeight;
    const constrainedMaxY = maxY - heightDiff / 2;
    const constrainedMinY = minY + heightDiff / 2;

    // Create drag behaviors (only when not in viewOnly mode)
    const minDragBehavior = viewOnly ? null : createHandleDragBehavior({
      handleType: 'min',
      getState,
      getActions,
      priceToY,
      yToPrice,
      dimensions,
      liquidityData,
      onRangeChange,
    });

    const maxDragBehavior = viewOnly ? null : createHandleDragBehavior({
      handleType: 'max',
      getState,
      getActions,
      priceToY,
      yToPrice,
      dimensions,
      liquidityData,
      onRangeChange,
    });

    const centerDragBehavior = viewOnly ? null : createCenterDragBehavior({
      getState,
      getActions,
      priceToY,
      yToPrice,
      dimensions,
      liquidityData,
      onRangeChange,
    });

    // Draw the active range indicator bar (inside the background)
    const rangeBar = indicatorsGroup
      .append('rect')
      .attr('class', CHART_CLASSES.RANGE_INDICATOR)
      .attr('x', sidebarX)
      .attr('y', constrainedMaxY)
      .attr('width', CHART_DIMENSIONS.RANGE_INDICATOR_WIDTH)
      .attr('height', constrainedHeight)
      .attr('fill', CHART_COLORS.rangeActive)
      .attr('rx', 8)
      .attr('ry', 8);

    if (centerDragBehavior) {
      rangeBar.attr('cursor', 'move').call(centerDragBehavior as any);
    }

    // Max handle (top circle)
    const maxHandle = indicatorsGroup
      .append('circle')
      .attr('class', `price-range-element ${CHART_CLASSES.MAX_HANDLE}`)
      .attr('cx', indicatorCenterX)
      .attr('cy', constrainedMaxY + 8)
      .attr('r', CHART_DIMENSIONS.HANDLE_RADIUS)
      .attr('fill', CHART_COLORS.handleFill)
      .attr('stroke', CHART_COLORS.handleStroke)
      .attr('stroke-width', 1)
      .style('filter', CHART_COLORS.handleShadow);

    if (maxDragBehavior) {
      maxHandle.attr('cursor', 'ns-resize').call(maxDragBehavior as any);
    }

    // Min handle (bottom circle)
    const minHandle = indicatorsGroup
      .append('circle')
      .attr('class', `price-range-element ${CHART_CLASSES.MIN_HANDLE}`)
      .attr('cx', indicatorCenterX)
      .attr('cy', constrainedMinY - 8)
      .attr('r', CHART_DIMENSIONS.HANDLE_RADIUS)
      .attr('fill', CHART_COLORS.handleFill)
      .attr('stroke', CHART_COLORS.handleStroke)
      .attr('stroke-width', 1)
      .style('filter', CHART_COLORS.handleShadow);

    if (minDragBehavior) {
      minHandle.attr('cursor', 'ns-resize').call(minDragBehavior as any);
    }

    // Center handle (rectangle in middle)
    const centerY = (constrainedMaxY + constrainedMinY) / 2;
    const centerHandle = indicatorsGroup
      .append('rect')
      .attr('class', `price-range-element ${CHART_CLASSES.CENTER_HANDLE}`)
      .attr('x', indicatorCenterX - CHART_DIMENSIONS.CENTER_HANDLE_WIDTH / 2)
      .attr('y', centerY - CHART_DIMENSIONS.CENTER_HANDLE_HEIGHT / 2)
      .attr('width', CHART_DIMENSIONS.CENTER_HANDLE_WIDTH)
      .attr('height', CHART_DIMENSIONS.CENTER_HANDLE_HEIGHT)
      .attr('fill', CHART_COLORS.handleFill)
      .attr('stroke', CHART_COLORS.handleStroke)
      .attr('stroke-width', 1)
      .attr('rx', 2)
      .attr('ry', 2)
      .style('filter', CHART_COLORS.handleShadow);

    if (centerDragBehavior) {
      centerHandle.attr('cursor', 'move').call(centerDragBehavior as any);
    }

    // Add 3 grip lines inside the center handle
    for (let i = 0; i < 3; i++) {
      indicatorsGroup
        .append('rect')
        .attr('class', 'center-grip-line')
        .attr('x', indicatorCenterX - 1.75 + i * 1.5)
        .attr('y', centerY - 1.5)
        .attr('width', 0.5)
        .attr('height', 3)
        .attr('fill', 'rgba(0, 0, 0, 0.3)')
        .style('pointer-events', 'none');
    }
  };

  return { draw };
}
