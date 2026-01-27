/**
 * Liquidity Bars Overlay Renderer
 *
 * Creates an invisible overlay for hover detection and drag-to-draw range creation.
 * Based on Uniswap's LiquidityBarsOverlayRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS } from '../constants';
import type { ChartEntry, ChartState, ChartActions, TickScale, YToPriceFn, Renderer } from '../types';

export interface LiquidityBarsOverlayRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getActions: () => ChartActions;
  getLiquidityData: () => ChartEntry[];
  getTickScale: () => TickScale;
  getYToPrice: () => YToPriceFn;
  onRangeChange: (minPrice: number, maxPrice: number) => void;
  /** When true, disables all drag interactions */
  viewOnly?: boolean;
}

export function createLiquidityBarsOverlayRenderer({
  g,
  getState,
  getActions,
  getLiquidityData,
  getTickScale,
  getYToPrice,
  onRangeChange,
  viewOnly = false,
}: LiquidityBarsOverlayRendererConfig): Renderer {
  let liquidityOverlay: d3.Selection<SVGRectElement, unknown, null, undefined> | null = null;

  const draw = (): void => {
    // Clear previous overlay
    if (liquidityOverlay) {
      liquidityOverlay.remove();
    }

    const state = getState();
    const liquidityData = getLiquidityData();
    const tickScale = getTickScale();
    const yToPrice = getYToPrice();
    const actions = getActions();

    const { dimensions, isFullRange } = state;

    if (liquidityData.length === 0) {
      return;
    }

    // Calculate overlay positioning - covers the liquidity bars area
    const liquidityWidth = CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET;

    // Add invisible overlay for better hover detection across the entire liquidity area
    liquidityOverlay = g
      .append('rect')
      .attr('class', 'liquidity-overlay')
      .attr('x', dimensions.width)
      .attr('y', 0)
      .attr('width', liquidityWidth)
      .attr('height', dimensions.height)
      .attr('fill', 'transparent')
      .on('mousemove', function(event) {
        // Don't handle hover if we're currently dragging
        const currentState = getState();
        if (currentState.dragStartY !== null) {
          return;
        }

        // Calculate which bar is being hovered based on Y position
        const [, y] = d3.pointer(event);

        // Find the liquidity bar at this Y position
        const hoveredBar = liquidityData.find((d) => {
          const barY = tickScale(d.tick.toString()) ?? 0;
          const barHeight = tickScale.bandwidth();
          return y >= barY && y <= barY + barHeight;
        });

        if (hoveredBar) {
          const barY = tickScale(hoveredBar.tick.toString()) ?? 0;
          actions.setChartState({
            hoveredY: barY + tickScale.bandwidth() / 2, // Center of the bar
            hoveredTick: hoveredBar,
          });
        } else {
          actions.setChartState({
            hoveredY: undefined,
            hoveredTick: undefined,
          });
        }
      })
      .on('mouseleave', function() {
        actions.setChartState({
          hoveredY: undefined,
          hoveredTick: undefined,
        });
      });

    // Set cursor based on mode
    // In viewOnly mode or full range, no interactions
    if (viewOnly || isFullRange) {
      liquidityOverlay.attr('cursor', 'default');
      return;
    }

    liquidityOverlay.attr('cursor', 'crosshair');

    // Helper function to calculate and constrain price range
    const calculatePriceRange = (startY: number, endY: number) => {
      const startPrice = yToPrice(startY);
      const endPrice = yToPrice(endY);

      // Check for invalid prices
      if (!isFinite(startPrice) || !isFinite(endPrice) || startPrice <= 0 || endPrice <= 0) {
        return { constrainedMinPrice: NaN, constrainedMaxPrice: NaN };
      }

      // Determine new min/max based on drag direction
      const newMinPrice = Math.min(startPrice, endPrice);
      const newMaxPrice = Math.max(startPrice, endPrice);

      // Get data bounds - handle empty data
      if (liquidityData.length === 0) {
        return { constrainedMinPrice: NaN, constrainedMaxPrice: NaN };
      }
      const allPrices = liquidityData.map((d) => d.price0);
      const dataMin = Math.min(...allPrices);
      const dataMax = Math.max(...allPrices);

      // Constrain to data bounds
      const constrainedMinPrice = Math.max(newMinPrice, dataMin);
      const constrainedMaxPrice = Math.min(newMaxPrice, dataMax);

      return { constrainedMinPrice, constrainedMaxPrice };
    };

    // Helper function to handle common drag logic
    const handleDragEvent = ({
      event,
      isEnd,
    }: {
      event: d3.D3DragEvent<SVGRectElement, unknown, unknown>;
      isEnd: boolean;
    }) => {
      const currentState = getState();
      if (currentState.dragStartY === null) {
        return;
      }

      const { constrainedMinPrice, constrainedMaxPrice } = calculatePriceRange(
        currentState.dragStartY,
        event.y
      );

      // Only update if we have a valid range
      if (
        isFinite(constrainedMinPrice) &&
        isFinite(constrainedMaxPrice) &&
        constrainedMinPrice > 0 &&
        constrainedMaxPrice > 0 &&
        constrainedMaxPrice > constrainedMinPrice
      ) {
        actions.setChartState({
          minPrice: constrainedMinPrice,
          maxPrice: constrainedMaxPrice,
        });
      }

      if (isEnd) {
        // Clear drag state
        actions.setChartState({
          dragStartY: null,
          dragCurrentY: undefined,
          dragStartTick: undefined,
          dragCurrentTick: undefined,
        });

        // Only notify parent if we have valid prices
        if (
          constrainedMaxPrice > constrainedMinPrice &&
          isFinite(constrainedMinPrice) &&
          isFinite(constrainedMaxPrice) &&
          constrainedMinPrice > 0 &&
          constrainedMaxPrice > 0
        ) {
          onRangeChange(constrainedMinPrice, constrainedMaxPrice);
        }
      }
    };

    // Add drag behavior for range creation over liquidity area
    liquidityOverlay.call(
      d3
        .drag<SVGRectElement, unknown>()
        .on('start', (event) => {
          // Find the tick at drag start position
          const dragStartTick = liquidityData.find((d) => {
            const barY = tickScale(d.tick.toString()) ?? 0;
            const barHeight = tickScale.bandwidth();
            return event.y >= barY && event.y <= barY + barHeight;
          });

          actions.setChartState({
            dragStartY: event.y,
            dragStartTick,
            // Clear hover state when starting drag
            hoveredY: undefined,
            hoveredTick: undefined,
          });
        })
        .on('drag', (event) => {
          // Find the tick at current drag position
          const dragCurrentTick = liquidityData.find((d) => {
            const barY = tickScale(d.tick.toString()) ?? 0;
            const barHeight = tickScale.bandwidth();
            return event.y >= barY && event.y <= barY + barHeight;
          });

          actions.setChartState({
            dragCurrentTick,
            dragCurrentY: event.y,
          });

          handleDragEvent({ event, isEnd: false });
        })
        .on('end', (event) => handleDragEvent({ event, isEnd: true }))
    );
  };

  return { draw };
}
