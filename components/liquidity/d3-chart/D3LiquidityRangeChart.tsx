'use client';

/**
 * D3 Liquidity Range Chart - Interactive range selector for liquidity positions.
 * Agnostic to price inversion - all data should be pre-transformed by parent.
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { CHART_BEHAVIOR, CHART_DIMENSIONS } from './constants';
import type { ChartEntry, ChartState, ChartActions, TickScale, PriceToYFn, YToPriceFn, Renderer, PriceDataPoint } from './types';
import { createTickScale, priceToY, yToPrice } from './utils/scaleUtils';
import { calculateDynamicZoomMin, calculateRangeViewport, getClosestTick, boundPanY, getPriceDataBounds } from './utils/viewportUtils';
import { HistoryDuration } from '@/lib/chart';

// Renderers
import { createLiquidityBarsRenderer } from './renderers/LiquidityBarsRenderer';
import { createPriceLineRenderer } from './renderers/PriceLineRenderer';
import { createCurrentPriceRenderer } from './renderers/CurrentPriceRenderer';
import { createRangeAreaRenderer } from './renderers/RangeAreaRenderer';
import { createMinMaxLinesRenderer } from './renderers/MinMaxLinesRenderer';
import { createRangeIndicatorsRenderer } from './renderers/RangeIndicatorsRenderer';
import { createLiquidityBarsOverlayRenderer } from './renderers/LiquidityBarsOverlayRenderer';
import { createTimescaleRenderer } from './renderers/TimescaleRenderer';

export interface D3LiquidityRangeChartProps {
  liquidityData: ChartEntry[];
  priceData: PriceDataPoint[];
  currentPrice: number;
  currentTick?: number;
  minPrice?: number;
  maxPrice?: number;
  isFullRange?: boolean;
  duration?: HistoryDuration;
  onRangeChange: (minPrice: number, maxPrice: number) => void;
  className?: string;
}

export interface D3LiquidityRangeChartHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  centerRange: () => void;
  reset: () => void;
}

export const D3LiquidityRangeChart = forwardRef<D3LiquidityRangeChartHandle, D3LiquidityRangeChartProps>(function D3LiquidityRangeChart({
  liquidityData,
  priceData,
  currentPrice,
  currentTick,
  minPrice: propMinPrice,
  maxPrice: propMaxPrice,
  isFullRange = false,
  duration = HistoryDuration.MONTH,
  onRangeChange,
  className,
}, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use refs for values that renderers need to access (avoids stale closures)
  const stateRef = useRef<ChartState>({
    dimensions: { width: 0, height: CHART_DIMENSIONS.CHART_HEIGHT },
    minPrice: propMinPrice,
    maxPrice: propMaxPrice,
    currentPrice,
    zoomLevel: 1,
    panY: 0,
    isDragging: false,
    isFullRange,
    // Hover state
    isChartHovered: false,
    hoveredY: undefined,
    hoveredTick: undefined,
    // Drag state
    dragStartY: null,
    dragCurrentY: undefined,
    dragStartTick: undefined,
    dragCurrentTick: undefined,
  });

  const liquidityDataRef = useRef<ChartEntry[]>([]);
  const priceDataRef = useRef<PriceDataPoint[]>([]);
  const tickScaleRef = useRef<TickScale | null>(null);
  const renderersRef = useRef<Record<string, Renderer | null>>({});
  const dynamicZoomMinRef = useRef<number>(CHART_BEHAVIOR.ZOOM_MIN);

  // React state for triggering re-renders
  const [dimensions, setDimensions] = useState({ width: 0, height: CHART_DIMENSIONS.CHART_HEIGHT });
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync liquidityData prop to ref (renderers access via ref)
  useEffect(() => {
    liquidityDataRef.current = liquidityData;
    dynamicZoomMinRef.current = calculateDynamicZoomMin(liquidityData.length);
  }, [liquidityData]);

  /**
   * Expose chart actions via ref (Uniswap pattern)
   * @see interface/.../store/actions/viewActions.ts
   */
  useImperativeHandle(ref, () => ({
    /**
     * Zoom in - increase zoom level by ZOOM_FACTOR
     */
    zoomIn: () => {
      const { zoomLevel, panY, dimensions: dims } = stateRef.current;
      const targetZoom = Math.min(zoomLevel * CHART_BEHAVIOR.ZOOM_FACTOR, CHART_BEHAVIOR.ZOOM_MAX);

      // Calculate new panY to keep center fixed during zoom
      const viewportHeight = dims.height;
      const centerY = viewportHeight / 2;
      const zoomRatio = targetZoom / zoomLevel;
      let newPanY = centerY - (centerY - panY) * zoomRatio;

      // Bound panY to prevent content underflow
      const data = liquidityDataRef.current;
      if (data.length > 0) {
        newPanY = boundPanY({
          panY: newPanY,
          viewportHeight,
          liquidityData: data,
          zoomLevel: targetZoom,
        });
      }

      // Update state and scale
      stateRef.current.zoomLevel = targetZoom;
      stateRef.current.panY = newPanY;

      // Recreate tick scale with new zoom/pan
      if (data.length > 0) {
        tickScaleRef.current = createTickScale(data, dims, targetZoom, newPanY);
      }

      // Redraw all renderers
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    },

    /**
     * Zoom out - decrease zoom level by ZOOM_FACTOR
     */
    zoomOut: () => {
      const { zoomLevel, panY, dimensions: dims } = stateRef.current;
      const dynamicZoomMin = dynamicZoomMinRef.current;
      const targetZoom = Math.max(zoomLevel / CHART_BEHAVIOR.ZOOM_FACTOR, dynamicZoomMin);

      // Calculate new panY to keep center fixed during zoom
      const viewportHeight = dims.height;
      const centerY = viewportHeight / 2;
      const zoomRatio = targetZoom / zoomLevel;
      let newPanY = centerY - (centerY - panY) * zoomRatio;

      // Bound panY to prevent content underflow
      const data = liquidityDataRef.current;
      if (data.length > 0) {
        newPanY = boundPanY({
          panY: newPanY,
          viewportHeight,
          liquidityData: data,
          zoomLevel: targetZoom,
        });
      }

      // Update state and scale
      stateRef.current.zoomLevel = targetZoom;
      stateRef.current.panY = newPanY;

      // Recreate tick scale with new zoom/pan
      if (data.length > 0) {
        tickScaleRef.current = createTickScale(data, dims, targetZoom, newPanY);
      }

      // Redraw all renderers
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    },

    /**
     * Center range - zoom and pan to fit the selected price range
     */
    centerRange: () => {
      const { minPrice, maxPrice, dimensions: dims } = stateRef.current;
      const data = liquidityDataRef.current;
      const dynamicZoomMin = dynamicZoomMinRef.current;

      if (minPrice === undefined || maxPrice === undefined || data.length === 0) {
        return;
      }

      // Find the ticks that correspond to minPrice and maxPrice
      const { index: minTickIndex } = getClosestTick(data, minPrice);
      const { index: maxTickIndex } = getClosestTick(data, maxPrice);

      const { targetZoom, targetPanY } = calculateRangeViewport({
        minTickIndex,
        maxTickIndex,
        liquidityData: data,
        dimensions: dims,
        dynamicZoomMin,
      });

      // Update state and scale
      stateRef.current.zoomLevel = targetZoom;
      stateRef.current.panY = targetPanY;

      // Recreate tick scale with new zoom/pan
      tickScaleRef.current = createTickScale(data, dims, targetZoom, targetPanY);

      // Redraw all renderers
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    },

    /**
     * Reset - calculate default range from price data and center view
     */
    reset: () => {
      const { dimensions: dims, isFullRange: fullRange } = stateRef.current;
      const data = liquidityDataRef.current;
      const priceData = priceDataRef.current;
      const dynamicZoomMin = dynamicZoomMinRef.current;

      if (data.length === 0) {
        return;
      }

      // If full range, use the min and max liquidity data points
      const minPriceValue = data[0].price0;
      const maxPriceValue = data[data.length - 1].price0;

      if (fullRange) {
        // For full range, just center the view on all data
        const { targetZoom, targetPanY } = calculateRangeViewport({
          minTickIndex: 0,
          maxTickIndex: data.length - 1,
          liquidityData: data,
          dimensions: dims,
          dynamicZoomMin,
        });

        stateRef.current.zoomLevel = targetZoom;
        stateRef.current.panY = targetPanY;
        stateRef.current.minPrice = minPriceValue;
        stateRef.current.maxPrice = maxPriceValue;

        tickScaleRef.current = createTickScale(data, dims, targetZoom, targetPanY);

        // Notify parent
        onRangeChange(minPriceValue, maxPriceValue);
      } else {
        // Calculate default range from price data (20%-80% of viewport)
        const priceBounds = getPriceDataBounds(priceData);
        const lastPrice = priceData.length > 0 ? priceData[priceData.length - 1].value : currentPrice;

        // Calculate viewport bounds centered on current price
        const maxSpread = Math.max(lastPrice - priceBounds.min, priceBounds.max - lastPrice);
        const viewportRange = 2 * maxSpread;
        const minVisiblePrice = lastPrice - viewportRange / 2;
        const maxVisiblePrice = lastPrice + viewportRange / 2;

        // Take 20%-80% of the viewport range
        const visibleRange = maxVisiblePrice - minVisiblePrice;
        const defaultMinPrice = minVisiblePrice + visibleRange * 0.2;
        const defaultMaxPrice = minVisiblePrice + visibleRange * 0.8;

        // Find ticks for calculated default prices
        const { index: minTickIndex } = getClosestTick(data, defaultMinPrice);
        const { index: maxTickIndex } = getClosestTick(data, defaultMaxPrice);
        const finalMinPrice = data[minTickIndex]?.price0 || defaultMinPrice;
        const finalMaxPrice = data[maxTickIndex]?.price0 || defaultMaxPrice;

        const { targetZoom, targetPanY } = calculateRangeViewport({
          minTickIndex,
          maxTickIndex,
          liquidityData: data,
          dimensions: dims,
          dynamicZoomMin,
        });

        stateRef.current.zoomLevel = targetZoom;
        stateRef.current.panY = targetPanY;
        stateRef.current.minPrice = finalMinPrice;
        stateRef.current.maxPrice = finalMaxPrice;

        tickScaleRef.current = createTickScale(data, dims, targetZoom, targetPanY);

        // Notify parent
        onRangeChange(finalMinPrice, finalMaxPrice);
      }

      // Redraw all renderers
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    },
  }), [currentPrice, onRangeChange]);

  // Sync props to ref (chart is agnostic to inversion - all values come pre-transformed)
  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      minPrice: propMinPrice,
      maxPrice: propMaxPrice,
      currentPrice,
      isFullRange,
    };
  }, [propMinPrice, propMaxPrice, currentPrice, isFullRange]);

  // Sync priceData prop to ref
  useEffect(() => {
    priceDataRef.current = priceData;
  }, [priceData]);

  // Update dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = (setInitialized = false) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Only update if we have a valid width
        if (rect.width > 0) {
          const width = Math.max(200, rect.width - CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH);
          const newDims = { width, height: CHART_DIMENSIONS.CHART_HEIGHT };
          setDimensions(newDims);
          stateRef.current.dimensions = newDims;
          if (setInitialized) {
            setIsInitialized(true);
          }
          return true;
        }
      }
      return false;
    };

    // Try to get dimensions, retry if container not ready
    let retryCount = 0;
    const tryUpdateDimensions = () => {
      if (updateDimensions(true)) {
        return; // Success
      }
      // Retry up to 10 times with increasing delays
      if (retryCount < 10) {
        retryCount++;
        setTimeout(tryUpdateDimensions, retryCount * 50);
      } else {
        setIsInitialized(true);
      }
    };

    requestAnimationFrame(tryUpdateDimensions);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => updateDimensions(false));
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Create scale functions bound to current data
  const createPriceToY = useCallback((): PriceToYFn => {
    return ({ price, tickAlignment }) => {
      const data = liquidityDataRef.current;
      const scale = tickScaleRef.current;
      if (!data.length || !scale) return stateRef.current.dimensions.height / 2;
      return priceToY({ price, liquidityData: data, tickScale: scale, tickAlignment });
    };
  }, []);

  const createYToPrice = useCallback((): YToPriceFn => {
    return (y: number) => {
      const data = liquidityDataRef.current;
      const scale = tickScaleRef.current;
      if (!data.length || !scale) return currentPrice;
      const price = yToPrice({ y, liquidityData: data, tickScale: scale });
      // Return currentPrice as fallback if yToPrice returns invalid value
      return isFinite(price) && price > 0 ? price : currentPrice;
    };
  }, [currentPrice]);

  // Draw all renderers
  const drawAll = useCallback(() => {
    Object.values(renderersRef.current).forEach(renderer => {
      if (renderer) renderer.draw();
    });
  }, []);

  // Actions for renderers
  const actionsRef = useRef<ChartActions>({
    setMinPrice: (price) => { stateRef.current.minPrice = price; },
    setMaxPrice: (price) => { stateRef.current.maxPrice = price; },
    setRange: (min, max) => {
      stateRef.current.minPrice = min;
      stateRef.current.maxPrice = max;
    },
    setZoomLevel: (zoom) => { stateRef.current.zoomLevel = zoom; },
    setPanY: (panY) => { stateRef.current.panY = panY; },
    setIsDragging: (isDragging) => { stateRef.current.isDragging = isDragging; },
    setHoveredTick: (tick) => { stateRef.current.hoveredTick = tick; },
    setChartState: (updates) => {
      stateRef.current = { ...stateRef.current, ...updates };
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    },
    handlePriceChange: (type, price) => {
      if (type === 'min') {
        stateRef.current.minPrice = price;
      } else {
        stateRef.current.maxPrice = price;
      }
      // Notify parent
      const { minPrice, maxPrice } = stateRef.current;
      if (minPrice !== undefined && maxPrice !== undefined) {
        onRangeChange(minPrice, maxPrice);
      }
    },
    zoomIn: () => {},
    zoomOut: () => {},
    centerRange: () => {},
    drawAll,
  });

  // Initialize renderers when data and dimensions are ready
  useEffect(() => {
    if (!svgRef.current || !isInitialized || liquidityData.length === 0) {
      return;
    }

    // Use fallback width if dimensions weren't measured properly
    const effectiveDimensions = dimensions.width > 0
      ? dimensions
      : { width: 400, height: CHART_DIMENSIONS.CHART_HEIGHT };

    if (dimensions.width <= 0) {
      stateRef.current.dimensions = effectiveDimensions;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Add background for visibility
    svg.append('rect')
      .attr('width', effectiveDimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH)
      .attr('height', effectiveDimensions.height)
      .attr('fill', 'rgba(255, 255, 255, 0.02)')
      .attr('rx', 8);

    // Calculate initial viewport (Uniswap pattern)
    const dynamicZoomMin = calculateDynamicZoomMin(liquidityData.length);

    // Use current price to center if no range set, otherwise center on range
    const effectiveMinPrice = propMinPrice ?? currentPrice * 0.8;
    const effectiveMaxPrice = propMaxPrice ?? currentPrice * 1.2;

    const { index: minTickIndex } = getClosestTick(liquidityData, effectiveMinPrice);
    const { index: maxTickIndex } = getClosestTick(liquidityData, effectiveMaxPrice);

    const { targetZoom, targetPanY } = calculateRangeViewport({
      minTickIndex,
      maxTickIndex,
      liquidityData,
      dynamicZoomMin,
      dimensions: effectiveDimensions,
    });

    // Update state with calculated viewport
    stateRef.current.zoomLevel = targetZoom;
    stateRef.current.panY = targetPanY;

    // Create tick scale with calculated zoom and pan
    const scale = createTickScale(liquidityData, effectiveDimensions, targetZoom, targetPanY);
    tickScaleRef.current = scale;

    // Create main group
    const mainGroup = svg.append('g');

    // Getter functions that always return fresh values
    const getState = () => stateRef.current;
    const getActions = () => actionsRef.current;
    const getLiquidityData = () => liquidityDataRef.current;
    const getPriceData = () => priceDataRef.current;
    const getTickScale = () => tickScaleRef.current!;
    const getPriceToY = createPriceToY;
    const getYToPrice = createYToPrice;

    // Initialize renderers in order (back to front)
    renderersRef.current = {
      rangeArea: createRangeAreaRenderer({
        g: mainGroup,
        getState,
        getPriceToY,
      }),
      priceLine: createPriceLineRenderer({
        g: mainGroup,
        getState,
        getPriceData,
        getPriceToY,
      }),
      liquidityBars: createLiquidityBarsRenderer({
        g: mainGroup,
        getState,
        getLiquidityData,
        getTickScale,
      }),
      minMaxLines: createMinMaxLinesRenderer({
        g: mainGroup,
        getState,
        getActions,
        getPriceToY,
        getYToPrice,
        getLiquidityData,
        onRangeChange,
      }),
      currentPrice: createCurrentPriceRenderer({
        g: mainGroup,
        getState,
        getPriceToY,
      }),
      rangeIndicators: createRangeIndicatorsRenderer({
        g: mainGroup,
        getState,
        getActions,
        getPriceToY,
        getYToPrice,
        getLiquidityData,
        onRangeChange,
      }),
      // Overlay must be last for event handling
      overlay: createLiquidityBarsOverlayRenderer({
        g: mainGroup,
        getState,
        getActions,
        getLiquidityData,
        getTickScale,
        getYToPrice,
        onRangeChange,
      }),
      // Timescale (X-axis date labels) at the bottom
      timescale: createTimescaleRenderer({
        g: mainGroup,
        getState,
        getPriceData,
        duration,
      }),
    };

    // Initial draw
    drawAll();

    return () => {
      renderersRef.current = {};
    };
  }, [isInitialized, liquidityData, dimensions, createPriceToY, createYToPrice, drawAll, onRangeChange, currentPrice, propMinPrice, propMaxPrice, duration]);

  // Redraw when props change
  useEffect(() => {
    if (Object.keys(renderersRef.current).length > 0) {
      drawAll();
    }
  }, [propMinPrice, propMaxPrice, isFullRange, priceData, drawAll]);

  // Handle wheel zoom and pan - attached to container for better event capture
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Wheel zoom handler
    const handleWheel = (event: WheelEvent) => {
      // Only handle if we have data
      const data = liquidityDataRef.current;
      if (data.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const { zoomLevel, panY, dimensions: dims } = stateRef.current;
      const dynamicZoomMin = dynamicZoomMinRef.current;

      // Check if shift is held for pan mode
      if (event.shiftKey) {
        // Shift + scroll = pan vertically
        let newPanY = panY - event.deltaY;
        newPanY = boundPanY({
          panY: newPanY,
          viewportHeight: dims.height,
          liquidityData: data,
          zoomLevel,
        });

        stateRef.current.panY = newPanY;

        if (data.length > 0) {
          tickScaleRef.current = createTickScale(data, dims, zoomLevel, newPanY);
        }

        Object.values(renderersRef.current).forEach(renderer => {
          if (renderer) renderer.draw();
        });
        return;
      }

      // Normal scroll = zoom
      // Determine zoom direction (positive deltaY = zoom out, negative = zoom in)
      const zoomingIn = event.deltaY < 0;
      const zoomFactor = zoomingIn ? CHART_BEHAVIOR.ZOOM_FACTOR : 1 / CHART_BEHAVIOR.ZOOM_FACTOR;
      const targetZoom = Math.max(dynamicZoomMin, Math.min(zoomLevel * zoomFactor, CHART_BEHAVIOR.ZOOM_MAX));

      // Skip if zoom wouldn't change
      if (targetZoom === zoomLevel) return;

      // Get mouse position relative to container for zoom anchoring
      const rect = container.getBoundingClientRect();
      const mouseY = event.clientY - rect.top;

      // Calculate new panY to keep the point under the mouse fixed
      const zoomRatio = targetZoom / zoomLevel;
      let newPanY = mouseY - (mouseY - panY) * zoomRatio;

      // Apply relaxed bounds for free viewport movement
      newPanY = boundPanY({
        panY: newPanY,
        viewportHeight: dims.height,
        liquidityData: data,
        zoomLevel: targetZoom,
      });

      // Update state and scale
      stateRef.current.zoomLevel = targetZoom;
      stateRef.current.panY = newPanY;

      // Recreate tick scale with new zoom/pan
      if (data.length > 0) {
        tickScaleRef.current = createTickScale(data, dims, targetZoom, newPanY);
      }

      // Redraw all renderers
      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    };

    // Middle mouse button or right-click drag for panning
    let isPanning = false;
    let panStartY = 0;
    let panStartPanY = 0;

    const handleMouseDown = (event: MouseEvent) => {
      // Middle mouse button (button 1)
      if (event.button === 1) {
        event.preventDefault();
        isPanning = true;
        panStartY = event.clientY;
        panStartPanY = stateRef.current.panY;
        container.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isPanning) return;

      const { zoomLevel, dimensions: dims } = stateRef.current;
      const data = liquidityDataRef.current;
      if (data.length === 0) return;

      const deltaY = event.clientY - panStartY;

      let newPanY = panStartPanY + deltaY;
      newPanY = boundPanY({
        panY: newPanY,
        viewportHeight: dims.height,
        liquidityData: data,
        zoomLevel,
      });

      stateRef.current.panY = newPanY;

      if (data.length > 0) {
        tickScaleRef.current = createTickScale(data, dims, zoomLevel, newPanY);
      }

      Object.values(renderersRef.current).forEach(renderer => {
        if (renderer) renderer.draw();
      });
    };

    const handleMouseUp = () => {
      if (isPanning) {
        isPanning = false;
        container.style.cursor = '';
      }
    };

    // Attach to container for better event capture
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Total height includes chart + timescale
  const totalHeight = CHART_DIMENSIONS.CHART_HEIGHT + CHART_DIMENSIONS.TIMESCALE_HEIGHT;

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full overflow-hidden', className)}
      style={{ height: totalHeight }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height={totalHeight}
        style={{ touchAction: 'manipulation' }}
      />
    </div>
  );
});

export default D3LiquidityRangeChart;
