/**
 * D3 Drag Behaviors
 *
 * Factory functions for creating D3 drag behaviors for range handles.
 * Based on Uniswap's dragActions.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS } from '../constants';
import type { ChartState, ChartActions, PriceToYFn, YToPriceFn, ChartEntry, ChartDimensions, HandleType } from '../types';
import { findClosestTick } from './scaleUtils';

export interface HandleDragConfig {
  handleType: HandleType;
  getState: () => ChartState;
  getActions: () => ChartActions;
  priceToY: PriceToYFn;
  yToPrice: YToPriceFn;
  dimensions: ChartDimensions;
  liquidityData: ChartEntry[];
  onRangeChange: (minPrice: number, maxPrice: number) => void;
}

/**
 * Create a drag behavior for min or max handles.
 */
export function createHandleDragBehavior({
  handleType,
  getState,
  getActions,
  priceToY,
  yToPrice,
  dimensions,
  liquidityData,
  onRangeChange,
}: HandleDragConfig): d3.DragBehavior<SVGElement, unknown, unknown> {
  let initialMinPrice: number | undefined;
  let initialMaxPrice: number | undefined;

  // Helper to clamp Y to chart bounds
  const clampYToChartBounds = (y: number): number =>
    Math.max(
      -CHART_DIMENSIONS.DRAG_BOUNDARY_MARGIN,
      Math.min(dimensions.height + CHART_DIMENSIONS.DRAG_BOUNDARY_MARGIN, y)
    );

  // Helper to check if lines should swap (crossed each other)
  const shouldSwapLines = (draggedY: number, otherY: number): boolean => {
    return handleType === 'min' ? draggedY < otherY : draggedY > otherY;
  };

  // Helper to apply minimum height constraint
  const applyMinHeightConstraint = (draggedY: number, otherY: number): number => {
    const pixelDistance = Math.abs(draggedY - otherY);
    if (pixelDistance < CHART_DIMENSIONS.RANGE_MIN_HEIGHT) {
      return handleType === 'min'
        ? otherY + CHART_DIMENSIONS.RANGE_MIN_HEIGHT
        : otherY - CHART_DIMENSIONS.RANGE_MIN_HEIGHT;
    }
    return draggedY;
  };

  // Calculate final prices from drag
  const calculateFinalPrices = (draggedY: number) => {
    const otherPrice = handleType === 'min' ? initialMaxPrice : initialMinPrice;

    if (!otherPrice) {
      const newPrice = yToPrice(draggedY);
      return {
        finalMinPrice: handleType === 'min' ? newPrice : initialMinPrice,
        finalMaxPrice: handleType === 'min' ? initialMaxPrice : newPrice,
        constrainedY: draggedY,
      };
    }

    const otherY = priceToY({ price: otherPrice });
    const shouldSwap = shouldSwapLines(draggedY, otherY);
    const constrainedY = applyMinHeightConstraint(draggedY, otherY);
    const newPrice = yToPrice(draggedY);
    const constrainedPrice = yToPrice(constrainedY);

    let finalMinPrice: number | undefined;
    let finalMaxPrice: number | undefined;

    if (shouldSwap) {
      // Lines crossed - swap min and max
      const swappedMinPrice = handleType === 'min' ? otherPrice : newPrice;
      const swappedMaxPrice = handleType === 'min' ? newPrice : otherPrice;
      const swappedDistance = Math.abs(
        priceToY({ price: swappedMaxPrice }) - priceToY({ price: swappedMinPrice! })
      );

      if (swappedDistance >= CHART_DIMENSIONS.RANGE_MIN_HEIGHT) {
        finalMinPrice = swappedMinPrice;
        finalMaxPrice = swappedMaxPrice;
      } else {
        // Apply minimum height to swapped positions
        const constrainedSwapY = handleType === 'min'
          ? otherY - CHART_DIMENSIONS.RANGE_MIN_HEIGHT
          : otherY + CHART_DIMENSIONS.RANGE_MIN_HEIGHT;
        const constrainedSwapPrice = yToPrice(constrainedSwapY);

        finalMinPrice = handleType === 'min' ? otherPrice : constrainedSwapPrice;
        finalMaxPrice = handleType === 'min' ? constrainedSwapPrice : otherPrice;
      }
    } else {
      finalMinPrice = handleType === 'min' ? constrainedPrice : otherPrice;
      finalMaxPrice = handleType === 'min' ? otherPrice : constrainedPrice;
    }

    return { finalMinPrice, finalMaxPrice, constrainedY };
  };

  return d3.drag<SVGElement, unknown>()
    .on('start', () => {
      const state = getState();
      initialMinPrice = state.minPrice;
      initialMaxPrice = state.maxPrice;
      getActions().setIsDragging(true);
    })
    .on('drag', (event) => {
      const clampedY = clampYToChartBounds(event.y);
      const { finalMinPrice, finalMaxPrice } = calculateFinalPrices(clampedY);

      if (finalMinPrice !== undefined && finalMaxPrice !== undefined) {
        // Update state during drag (visual feedback)
        getActions().setRange(finalMinPrice, finalMaxPrice);
        getActions().drawAll();
      }
    })
    .on('end', (event) => {
      const clampedY = clampYToChartBounds(event.y);
      const { finalMinPrice, finalMaxPrice } = calculateFinalPrices(clampedY);

      getActions().setIsDragging(false);

      // Notify parent of final range
      if (finalMinPrice !== undefined && finalMaxPrice !== undefined) {
        onRangeChange(finalMinPrice, finalMaxPrice);
      }
    });
}

export interface CenterDragConfig {
  getState: () => ChartState;
  getActions: () => ChartActions;
  priceToY: PriceToYFn;
  yToPrice: YToPriceFn;
  dimensions: ChartDimensions;
  liquidityData: ChartEntry[];
  onRangeChange: (minPrice: number, maxPrice: number) => void;
}

/**
 * Calculate tick indices with price information for efficient lookups
 * @see Uniswap tickUtils.ts calculateTickIndices
 */
function calculateTickIndices(liquidityData: ChartEntry[]): { tick: number; index: number; price: number }[] {
  return liquidityData.map((d, i) => ({
    tick: d.tick ?? 0,
    index: i,
    price: d.price0,
  }));
}

/**
 * Calculate new price range based on center tick and tick range size
 * @see Uniswap tickUtils.ts calculateNewRange
 */
function calculateNewRange({
  centerTick,
  tickRangeSize,
  tickIndices,
  liquidityData,
}: {
  centerTick: ChartEntry;
  tickRangeSize: number;
  tickIndices: { tick: number; index: number; price: number }[];
  liquidityData: ChartEntry[];
}): { minPrice: number | undefined; maxPrice: number | undefined } {
  const centerIndex = tickIndices.find(t => t.tick === centerTick.tick)?.index || 0;
  const halfRange = Math.floor(tickRangeSize / 2);

  const newMinIndex = Math.max(0, centerIndex - halfRange);
  const newMaxIndex = Math.min(liquidityData.length - 1, centerIndex + halfRange);

  return {
    minPrice: tickIndices[newMinIndex]?.price,
    maxPrice: tickIndices[newMaxIndex]?.price,
  };
}

/**
 * Create a drag behavior for the center handle (moves entire range).
 * Uses tick-based dragging (Uniswap pattern) for consistent range movement.
 *
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart/store/actions/dragActions.ts
 */
export function createCenterDragBehavior({
  getState,
  getActions,
  priceToY,
  yToPrice,
  dimensions,
  liquidityData,
  onRangeChange,
}: CenterDragConfig): d3.DragBehavior<SVGElement, unknown, unknown> {
  // Stored during drag start
  let dragOffsetY = 0;
  let tickRangeSize = 0;
  let tickIndices: { tick: number; index: number; price: number }[] = [];

  /**
   * Handle tick-based drag movement
   */
  const handleTickDrag = (event: d3.D3DragEvent<SVGElement, unknown, unknown>, isEnd: boolean) => {
    const state = getState();
    const { minPrice, maxPrice } = state;

    if (minPrice === undefined || maxPrice === undefined || liquidityData.length === 0) {
      return;
    }

    // Apply the stored offset to maintain consistent drag feel
    const adjustedY = event.y - dragOffsetY;
    const newCenterY = Math.max(0, Math.min(dimensions.height, adjustedY));
    const draggedPrice = yToPrice(newCenterY);

    // Find the tick corresponding to the dragged center position
    const centerTick = findClosestTick(liquidityData, draggedPrice);

    if (centerTick) {
      const newRange = calculateNewRange({
        centerTick,
        tickRangeSize,
        tickIndices,
        liquidityData,
      });

      // Get data bounds to prevent dragging outside chart
      const prices = liquidityData.map(d => d.price0);
      const dataBoundsMin = Math.min(...prices);
      const dataBoundsMax = Math.max(...prices);

      // Only update if range stays within data bounds
      if (
        newRange.minPrice !== undefined &&
        newRange.maxPrice !== undefined &&
        newRange.minPrice >= dataBoundsMin &&
        newRange.maxPrice <= dataBoundsMax
      ) {
        // Update state for all renderers (Uniswap pattern)
        getActions().setRange(newRange.minPrice, newRange.maxPrice);
        getActions().drawAll();

        // Call callbacks only when drag ends
        if (isEnd) {
          onRangeChange(newRange.minPrice, newRange.maxPrice);
        }
      }
    }
  };

  return d3.drag<SVGElement, unknown>()
    .on('start', (event) => {
      const state = getState();
      const { minPrice, maxPrice } = state;

      if (minPrice === undefined || maxPrice === undefined || liquidityData.length === 0) {
        return;
      }

      // Store the initial offset relative to the range center
      const currentRangeCenterY = (priceToY({ price: maxPrice }) + priceToY({ price: minPrice })) / 2;
      dragOffsetY = event.y - currentRangeCenterY;

      // Calculate tick indices for lookups
      tickIndices = calculateTickIndices(liquidityData);

      // Calculate and store the initial tick range size (Uniswap pattern)
      const minTick = findClosestTick(liquidityData, minPrice);
      const maxTick = findClosestTick(liquidityData, maxPrice);

      if (minTick && maxTick) {
        const minIndex = tickIndices.find(t => t.tick === minTick.tick)?.index || 0;
        const maxIndex = tickIndices.find(t => t.tick === maxTick.tick)?.index || 0;
        tickRangeSize = Math.abs(maxIndex - minIndex);
      }

      getActions().setIsDragging(true);
    })
    .on('drag', (event) => handleTickDrag(event, false))
    .on('end', (event) => {
      handleTickDrag(event, true);
      getActions().setIsDragging(false);
    });
}
