'use client';

/**
 * D3 Liquidity Range Chart
 *
 * Main orchestrator component for the D3-based interactive liquidity range chart.
 * Uses separate renderer modules for each visual layer.
 *
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { CHART_BEHAVIOR, CHART_DIMENSIONS, CHART_COLORS } from './constants';
import { getPoolSubgraphId } from '@/lib/pools-config';
import type { ChartEntry, ChartState, ChartActions, TickScale, PriceToYFn, YToPriceFn, Renderer, PriceDataPoint } from './types';
import { createTickScale, priceToY, yToPrice } from './utils/scaleUtils';
import { calculateDynamicZoomMin, calculateRangeViewport, getClosestTick, boundPanY, getPriceDataBounds } from './utils/viewportUtils';
import { LiquidityChartSkeleton } from './LiquidityChartSkeleton';
import { usePoolPriceChartData, HistoryDuration } from '@/lib/chart';

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
  poolId?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  tickSpacing: number;
  currentPrice: number;
  currentTick?: number; // Optional - skeleton shows until available
  minPrice?: number;
  maxPrice?: number;
  isFullRange?: boolean;
  priceData?: PriceDataPoint[];
  duration?: HistoryDuration;
  onRangeChange: (minPrice: number, maxPrice: number) => void;
  onDurationChange?: (duration: HistoryDuration) => void;
  className?: string;
}

/**
 * Ref handle for chart actions (Uniswap pattern)
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart/store/actions/viewActions.ts
 */
export interface D3LiquidityRangeChartHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  centerRange: () => void;
  reset: () => void;
}

export const D3LiquidityRangeChart = forwardRef<D3LiquidityRangeChartHandle, D3LiquidityRangeChartProps>(function D3LiquidityRangeChart({
  poolId,
  token0Symbol,
  token1Symbol,
  tickSpacing,
  currentPrice,
  currentTick,
  minPrice: propMinPrice,
  maxPrice: propMaxPrice,
  isFullRange = false,
  duration = HistoryDuration.MONTH,
  onRangeChange,
  onDurationChange,
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
  const [liquidityData, setLiquidityData] = useState<ChartEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

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

  // Sync props to ref
  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      minPrice: propMinPrice,
      maxPrice: propMaxPrice,
      currentPrice,
      isFullRange,
    };
  }, [propMinPrice, propMaxPrice, currentPrice, isFullRange]);

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
  }, [isLoading]); // Re-run when loading state changes so we measure the actual container

  // Get the subgraph pool ID for external API calls (Uniswap Gateway, subgraph)
  // This is required for the spoofed Uniswap Gateway headers to work correctly
  const subgraphPoolId = poolId ? (getPoolSubgraphId(poolId) || poolId) : undefined;

  // Fetch liquidity data
  useEffect(() => {
    let cancelled = false;

    const fetchLiquidityData = async () => {
      if (!poolId) {
        setLiquidityData([]);
        liquidityDataRef.current = [];
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const resp = await fetch('/api/liquidity/get-ticks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId: subgraphPoolId, first: 500 }),
        });

        if (!resp.ok) throw new Error(`API failed: ${resp.status}`);

        const json = await resp.json();
        const ticks = Array.isArray(json?.ticks) ? json.ticks : [];

        if (cancelled) return;

        // Convert ticks to ChartEntry format
        const sortedTicks = [...ticks].sort((a: any, b: any) =>
          parseInt(a.tickIdx) - parseInt(b.tickIdx)
        );

        let cumulativeLiquidity = 0;
        const chartEntries: ChartEntry[] = [];

        for (const tick of sortedTicks) {
          const tickIdx = parseInt(tick.tickIdx);
          const liquidityNet = parseFloat(tick.liquidityNet);

          if (!isNaN(tickIdx) && !isNaN(liquidityNet)) {
            cumulativeLiquidity += liquidityNet;
            const price0 = Math.pow(1.0001, tickIdx);

            chartEntries.push({
              tick: tickIdx,
              price0,
              price1: 1 / price0,
              activeLiquidity: Math.max(0, cumulativeLiquidity),
            });
          }
        }

        setLiquidityData(chartEntries);
        liquidityDataRef.current = chartEntries;
        // Update dynamic zoom minimum based on data length
        dynamicZoomMinRef.current = calculateDynamicZoomMin(chartEntries.length);
      } catch {
        setLiquidityData([]);
        liquidityDataRef.current = [];
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchLiquidityData();
    return () => { cancelled = true; };
  }, [subgraphPoolId]);

  // Fetch price data (same pattern as PositionRangeChart)
  // Uses subgraphPoolId for Uniswap Gateway compatibility (spoofed headers)
  // @see components/liquidity/PositionRangeChart/PositionRangeChart.tsx
  const { entries: priceEntries } = usePoolPriceChartData({
    variables: {
      poolId: subgraphPoolId,
      token0: token0Symbol,
      token1: token1Symbol,
      duration,
    },
    priceInverted: false,
  });

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
      return yToPrice({ y, liquidityData: data, tickScale: scale });
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

  // Redraw when props or price data change
  useEffect(() => {
    // Sync price data BEFORE drawing (must happen in same effect to avoid race)
    priceDataRef.current = priceEntries.map(e => ({ time: e.time, value: e.value }));

    if (Object.keys(renderersRef.current).length > 0) {
      drawAll();
    }
  }, [propMinPrice, propMaxPrice, isFullRange, priceEntries, drawAll]);

  // Determine if we should show the skeleton overlay
  // Show skeleton when: loading, no data, or missing essential props (poolId, currentTick)
  const showSkeleton = isLoading || liquidityData.length === 0 || !poolId || currentTick === undefined;

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

      {/* Skeleton overlay - shown while loading */}
      {showSkeleton && (
        <div className="absolute inset-0">
          <LiquidityChartSkeleton height={totalHeight} />
        </div>
      )}
    </div>
  );
});

export default D3LiquidityRangeChart;
