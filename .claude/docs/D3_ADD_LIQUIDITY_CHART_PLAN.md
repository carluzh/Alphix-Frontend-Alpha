# D3 Add Liquidity Chart - Implementation Plan

## Executive Summary

Build a new D3-based interactive range selection chart for the Add Liquidity wizard Step 2, inspired by Uniswap's `D3LiquidityRangeInput` component. This chart will combine:
- Historical price line (from existing `usePoolPriceChartData` hook)
- Liquidity depth bars (from existing `/api/liquidity/get-ticks` endpoint)
- Interactive drag handles for min/max price selection
- Zoom and pan capabilities

---

## Part 1: Component Architecture

### File Structure

```
components/liquidity/d3-chart/
├── D3LiquidityRangeChart.tsx          # Main orchestrator component
├── D3ChartProvider.tsx                 # State management context
├── constants.ts                        # Dimensions and styling constants
├── types.ts                            # TypeScript interfaces
├── hooks/
│   ├── useResponsiveDimensions.ts      # Container sizing
│   └── useChartInteractions.ts         # Wheel/zoom handlers
├── renderers/
│   ├── PriceLineRenderer.ts            # Historical price line
│   ├── LiquidityBarsRenderer.ts        # Liquidity depth bars
│   ├── RangeAreaRenderer.ts            # Selected range background
│   ├── MinMaxLinesRenderer.ts          # Min/max price lines + drag targets
│   ├── RangeHandlesRenderer.ts         # Drag handles (circles + center)
│   └── CurrentPriceRenderer.ts         # Current price indicator
├── utils/
│   ├── scales.ts                       # D3 scale factories
│   ├── colorUtils.ts                   # Color/opacity helpers
│   ├── priceToY.ts                     # Price ↔ Y coordinate conversion
│   └── dragBehaviors.ts                # D3 drag behavior factories
└── index.ts                            # Public exports
```

### Data Flow

```
RangeAndAmountsStep (Parent)
    ↓ Props: poolId, token0, token1, minPrice, maxPrice, onRangeChange
    ↓
D3LiquidityRangeChart
    ├── usePoolPriceChartData(poolId) → priceData[]
    ├── useLiquidityData(poolId) → liquidityData[]
    ├── useResponsiveDimensions() → { width, height }
    ↓
D3ChartProvider (State Context)
    ├── minPrice, maxPrice (controlled from parent)
    ├── zoomLevel, panY (local state)
    ├── hoveredTick (local state)
    ↓
SVG Element
    ├── PriceLineRenderer.draw()
    ├── LiquidityBarsRenderer.draw()
    ├── RangeAreaRenderer.draw()
    ├── MinMaxLinesRenderer.draw()
    ├── RangeHandlesRenderer.draw()
    └── CurrentPriceRenderer.draw()
```

---

## Part 2: Constants & Dimensions

### Chart Dimensions (constants.ts)

```typescript
export const CHART_DIMENSIONS = {
  // Main chart
  CHART_HEIGHT: 200,                    // Fixed height
  TIMESCALE_HEIGHT: 20,                 // Bottom axis
  LIQUIDITY_SECTION_WIDTH: 100,         // Right sidebar width

  // Bars
  LIQUIDITY_BAR_HEIGHT: 3,
  LIQUIDITY_BAR_SPACING: 1,

  // Lines and handles
  MIN_MAX_LINE_HEIGHT_VISIBLE: 3,       // Thin visible line
  MIN_MAX_LINE_HEIGHT_INTERACTIVE: 30,  // Wide invisible drag target
  HANDLE_RADIUS: 6,                     // Circle drag handles
  CENTER_HANDLE_WIDTH: 12,
  CENTER_HANDLE_HEIGHT: 6,
  CURRENT_PRICE_DOT_RADIUS: 4,

  // Constraints
  RANGE_MIN_HEIGHT: 40,                 // Minimum distance between handles
  DRAG_BOUNDARY_MARGIN: 10,             // Allow dragging slightly beyond edges
};

export const CHART_BEHAVIOR = {
  ZOOM_MIN: 0.5,
  ZOOM_MAX: 3,
  ZOOM_FACTOR: 1.3,                     // Mouse wheel zoom multiplier
  ANIMATION_DURATION: 200,
};
```

### Color Scheme (Using Alphix CSS Variables)

```typescript
export const CHART_COLORS = {
  // Range indicators (use sidebar-primary / accent)
  rangeActive: 'var(--sidebar-primary)',        // #e85102 (orange)
  rangeActiveOpacity: 0.3,

  // Liquidity bars
  barsInRange: 'var(--sidebar-primary)',
  barsInRangeOpacity: 0.5,
  barsOutOfRange: '#404040',
  barsOutOfRangeOpacity: 0.2,

  // Price line
  priceLineInRange: '#22c55e',                  // Green (in range)
  priceLineOutOfRange: '#6b7280',               // Grey (out of range)

  // Current price
  currentPriceLine: '#9ca3af',
  currentPriceDot: {
    inRange: 'var(--sidebar-primary)',
    outOfRange: '#6b7280',
  },

  // Handles
  handleFill: 'white',
  handleStroke: 'rgba(0,0,0,0.1)',
  handleShadow: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
};
```

---

## Part 3: Price Line Renderer

### Data Source
- Uses existing `usePoolPriceChartData` hook from `lib/chart/`
- Returns `PriceChartData[]` with `{ time: UTCTimestamp, value: number }`
- Duration: MONTH (30 days of history)

### Implementation Pattern

```typescript
// renderers/PriceLineRenderer.ts

export function createPriceLineRenderer({
  g,                    // D3 SVG group
  dimensions,           // { width, height }
  getState,             // () => { minPrice, maxPrice }
}: PriceLineRendererConfig) {
  const group = g.append('g').attr('class', 'price-line-group');

  return {
    draw(priceData: PriceChartData[], priceToY: PriceToYFn) {
      group.selectAll('*').remove();

      if (priceData.length === 0) return;

      const { minPrice, maxPrice } = getState();

      // Create time scale for X-axis
      const [minDate, maxDate] = d3.extent(priceData, d => new Date(d.time * 1000));
      const xScale = d3.scaleTime()
        .domain([minDate, maxDate])
        .range([0, dimensions.width]);

      // Create line generator
      const line = d3.line<PriceChartData>()
        .x(d => xScale(new Date(d.time * 1000)))
        .y(d => priceToY(d.value))
        .curve(d3.curveMonotoneX);

      const pathData = line(priceData);

      // If range is set, use dual-color pattern with SVG mask
      if (minPrice !== undefined && maxPrice !== undefined) {
        const maskId = `price-mask-${Math.random().toString(36).slice(2)}`;
        const minY = priceToY(minPrice);
        const maxY = priceToY(maxPrice);

        // Create mask for range
        const defs = group.append('defs');
        defs.append('mask')
          .attr('id', maskId)
          .append('rect')
          .attr('x', 0)
          .attr('y', maxY)
          .attr('width', dimensions.width)
          .attr('height', minY - maxY)
          .attr('fill', 'white');

        // Grey line (full path, out of range)
        group.append('path')
          .attr('d', pathData)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS.priceLineOutOfRange)
          .attr('stroke-width', 2);

        // Green line (masked to in-range only)
        group.append('path')
          .attr('d', pathData)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS.priceLineInRange)
          .attr('stroke-width', 2)
          .attr('mask', `url(#${maskId})`);
      } else {
        // No range: single grey line
        group.append('path')
          .attr('d', pathData)
          .attr('fill', 'none')
          .attr('stroke', CHART_COLORS.priceLineOutOfRange)
          .attr('stroke-width', 2);
      }
    }
  };
}
```

---

## Part 4: Liquidity Bars Renderer

### Data Source
- Reuse existing fetch pattern from `InteractiveRangeChart.tsx`
- API: `/api/liquidity/get-ticks`
- Returns: `{ ticks: [{ tickIdx, liquidityNet }] }`

### Cumulative Liquidity Calculation
Already implemented in `InteractiveRangeChart.tsx` lines 526-608. Will reuse this logic.

### Implementation Pattern

```typescript
// renderers/LiquidityBarsRenderer.ts

export function createLiquidityBarsRenderer({
  g,
  dimensions,
  getState,
}: LiquidityBarsRendererConfig) {
  const group = g.append('g').attr('class', 'liquidity-bars-group');

  return {
    draw(liquidityData: ChartEntry[], tickScale: d3.ScaleBand<string>) {
      group.selectAll('*').remove();

      if (liquidityData.length === 0) return;

      const { minPrice, maxPrice } = getState();

      // Create X scale for liquidity amounts (bars extend left)
      const maxLiquidity = d3.max(liquidityData, d => d.liquidity) || 1;
      const liquidityXScale = d3.scaleLinear()
        .domain([0, maxLiquidity])
        .range([0, CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - 20]);

      // Data join pattern for bars
      const bars = group
        .selectAll<SVGRectElement, ChartEntry>('.liquidity-bar')
        .data(liquidityData, d => d.tick.toString());

      bars.enter()
        .append('rect')
        .attr('class', 'liquidity-bar')
        .attr('x', d => dimensions.width - liquidityXScale(d.liquidity))
        .attr('y', d => tickScale(d.tick.toString()) || 0)
        .attr('width', d => liquidityXScale(d.liquidity))
        .attr('height', tickScale.bandwidth())
        .attr('fill', d => getColorForPrice(d.price, minPrice, maxPrice))
        .attr('opacity', d => getOpacityForPrice(d.price, minPrice, maxPrice));

      bars.exit().remove();
    }
  };
}

// Color utility functions
function getColorForPrice(price: number, minPrice?: number, maxPrice?: number): string {
  if (minPrice !== undefined && maxPrice !== undefined) {
    const isInRange = price >= minPrice && price <= maxPrice;
    return isInRange ? CHART_COLORS.barsInRange : CHART_COLORS.barsOutOfRange;
  }
  return CHART_COLORS.barsOutOfRange;
}

function getOpacityForPrice(price: number, minPrice?: number, maxPrice?: number): number {
  if (minPrice !== undefined && maxPrice !== undefined) {
    const isInRange = price >= minPrice && price <= maxPrice;
    return isInRange ? CHART_COLORS.barsInRangeOpacity : CHART_COLORS.barsOutOfRangeOpacity;
  }
  return CHART_COLORS.barsOutOfRangeOpacity;
}
```

---

## Part 5: Range Indicators & Drag Handles

### Visual Elements Stack

1. **Range Area Background** (lowest)
   - Pink/orange rectangle between min/max
   - Opacity: 0.2-0.3
   - Full chart width

2. **Min/Max Lines**
   - Visible line: 3px thick, 8% opacity
   - Invisible drag target: 30px thick, 0% opacity
   - Full chart width

3. **Drag Handles** (right sidebar)
   - Range background bar: 16px wide
   - Min/Max circles: 6px radius, white with shadow
   - Center handle: 12x6px rectangle with 3 grip lines

4. **Current Price Indicator** (topmost)
   - Dotted line across chart
   - Circle dot at right edge

### Implementation Pattern

```typescript
// renderers/RangeHandlesRenderer.ts

export function createRangeHandlesRenderer({
  g,
  dimensions,
  getState,
  onRangeChange,
}: RangeHandlesRendererConfig) {
  const group = g.append('g').attr('class', 'range-handles-group');

  // Create drag behaviors
  const minDragBehavior = createHandleDragBehavior({
    handleType: 'min',
    getState,
    onRangeChange,
    priceToY,
    yToPrice,
  });

  const maxDragBehavior = createHandleDragBehavior({
    handleType: 'max',
    getState,
    onRangeChange,
    priceToY,
    yToPrice,
  });

  const centerDragBehavior = createCenterDragBehavior({
    getState,
    onRangeChange,
    priceToY,
    yToPrice,
  });

  return {
    draw(priceToY: PriceToYFn, yToPrice: YToPriceFn) {
      group.selectAll('*').remove();

      const { minPrice, maxPrice } = getState();
      if (minPrice === undefined || maxPrice === undefined) return;

      const minY = priceToY(minPrice);
      const maxY = priceToY(maxPrice);
      const sidebarX = dimensions.width;
      const sidebarCenterX = sidebarX + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH / 2;

      // Range indicator background bar
      group.append('rect')
        .attr('class', 'range-indicator')
        .attr('x', sidebarX + 10)
        .attr('y', maxY)
        .attr('width', 16)
        .attr('height', Math.max(minY - maxY, CHART_DIMENSIONS.RANGE_MIN_HEIGHT))
        .attr('fill', CHART_COLORS.rangeActive)
        .attr('rx', 8)
        .attr('cursor', 'move')
        .call(centerDragBehavior);

      // Max handle (top)
      group.append('circle')
        .attr('class', 'max-handle')
        .attr('cx', sidebarCenterX)
        .attr('cy', maxY + 8)
        .attr('r', CHART_DIMENSIONS.HANDLE_RADIUS)
        .attr('fill', CHART_COLORS.handleFill)
        .attr('stroke', CHART_COLORS.handleStroke)
        .attr('stroke-width', 1)
        .style('filter', CHART_COLORS.handleShadow)
        .attr('cursor', 'ns-resize')
        .call(maxDragBehavior);

      // Min handle (bottom)
      group.append('circle')
        .attr('class', 'min-handle')
        .attr('cx', sidebarCenterX)
        .attr('cy', minY - 8)
        .attr('r', CHART_DIMENSIONS.HANDLE_RADIUS)
        .attr('fill', CHART_COLORS.handleFill)
        .attr('stroke', CHART_COLORS.handleStroke)
        .attr('stroke-width', 1)
        .style('filter', CHART_COLORS.handleShadow)
        .attr('cursor', 'ns-resize')
        .call(minDragBehavior);

      // Center handle
      const centerY = (minY + maxY) / 2;
      group.append('rect')
        .attr('class', 'center-handle')
        .attr('x', sidebarCenterX - 6)
        .attr('y', centerY - 3)
        .attr('width', CENTER_HANDLE_WIDTH)
        .attr('height', CENTER_HANDLE_HEIGHT)
        .attr('fill', CHART_COLORS.handleFill)
        .attr('stroke', CHART_COLORS.handleStroke)
        .attr('stroke-width', 1)
        .attr('rx', 2)
        .style('filter', CHART_COLORS.handleShadow)
        .attr('cursor', 'move')
        .call(centerDragBehavior);

      // Center grip lines (3 lines)
      for (let i = 0; i < 3; i++) {
        group.append('rect')
          .attr('x', sidebarCenterX - 3.5 + i * 2.5)
          .attr('y', centerY - 1.5)
          .attr('width', 0.5)
          .attr('height', 3)
          .attr('fill', 'rgba(0,0,0,0.3)')
          .style('pointer-events', 'none');
      }
    }
  };
}
```

---

## Part 6: Drag Behaviors

### Handle Drag (Min/Max)

```typescript
// utils/dragBehaviors.ts

export function createHandleDragBehavior({
  handleType,   // 'min' | 'max'
  getState,
  onRangeChange,
  priceToY,
  yToPrice,
  dimensions,
}: HandleDragConfig): d3.DragBehavior<Element, unknown, unknown> {
  let initialY: number;
  let initialMinPrice: number;
  let initialMaxPrice: number;

  return d3.drag()
    .on('start', (event) => {
      initialY = event.y;
      const state = getState();
      initialMinPrice = state.minPrice!;
      initialMaxPrice = state.maxPrice!;
    })
    .on('drag', (event) => {
      const draggedY = event.y;

      // Clamp to chart bounds
      const clampedY = Math.max(
        -CHART_DIMENSIONS.DRAG_BOUNDARY_MARGIN,
        Math.min(dimensions.height + CHART_DIMENSIONS.DRAG_BOUNDARY_MARGIN, draggedY)
      );

      const newPrice = yToPrice(clampedY);
      let newMin = initialMinPrice;
      let newMax = initialMaxPrice;

      if (handleType === 'min') {
        newMin = newPrice;
        // Enforce minimum distance
        if (priceToY(newMin) - priceToY(newMax) < CHART_DIMENSIONS.RANGE_MIN_HEIGHT) {
          newMin = yToPrice(priceToY(newMax) + CHART_DIMENSIONS.RANGE_MIN_HEIGHT);
        }
        // Swap if crossed
        if (newMin < newMax) {
          [newMin, newMax] = [newMax, newMin];
        }
      } else {
        newMax = newPrice;
        // Enforce minimum distance
        if (priceToY(newMin) - priceToY(newMax) < CHART_DIMENSIONS.RANGE_MIN_HEIGHT) {
          newMax = yToPrice(priceToY(newMin) - CHART_DIMENSIONS.RANGE_MIN_HEIGHT);
        }
        // Swap if crossed
        if (newMax > newMin) {
          [newMin, newMax] = [newMax, newMin];
        }
      }

      // Update visual position during drag
      onRangeChange(newMin, newMax, { isDragging: true });
    })
    .on('end', (event) => {
      const state = getState();
      // Final callback to parent
      onRangeChange(state.minPrice!, state.maxPrice!, { isDragging: false });
    });
}
```

### Center Drag (Move Entire Range)

```typescript
export function createCenterDragBehavior({
  getState,
  onRangeChange,
  priceToY,
  yToPrice,
}: CenterDragConfig): d3.DragBehavior<Element, unknown, unknown> {
  let startY: number;
  let startMinPrice: number;
  let startMaxPrice: number;
  let priceRange: number;

  return d3.drag()
    .on('start', (event) => {
      startY = event.y;
      const state = getState();
      startMinPrice = state.minPrice!;
      startMaxPrice = state.maxPrice!;
      priceRange = startMinPrice - startMaxPrice; // Price range to maintain
    })
    .on('drag', (event) => {
      const deltaY = event.y - startY;

      // Convert delta to price space
      const startMinY = priceToY(startMinPrice);
      const newMinY = startMinY + deltaY;
      const newMinPrice = yToPrice(newMinY);
      const newMaxPrice = newMinPrice - priceRange;

      // Validate bounds
      // (Add data bounds checking here)

      onRangeChange(newMinPrice, newMaxPrice, { isDragging: true });
    })
    .on('end', () => {
      const state = getState();
      onRangeChange(state.minPrice!, state.maxPrice!, { isDragging: false });
    });
}
```

---

## Part 7: State Management

### Simplified Approach (React Context + useReducer)

We'll use a simpler approach than Uniswap's full Zustand store:

```typescript
// D3ChartProvider.tsx

interface ChartState {
  // From parent (controlled)
  minPrice?: number;
  maxPrice?: number;

  // Local state
  zoomLevel: number;
  panY: number;
  hoveredTick?: ChartEntry;
  isDragging: boolean;
}

type ChartAction =
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_PAN'; panY: number }
  | { type: 'SET_HOVER'; tick?: ChartEntry }
  | { type: 'SET_DRAGGING'; isDragging: boolean }
  | { type: 'SYNC_PRICES'; minPrice?: number; maxPrice?: number };

const ChartContext = createContext<{
  state: ChartState;
  dispatch: Dispatch<ChartAction>;
  actions: ChartActions;
} | null>(null);

export function D3ChartProvider({
  children,
  minPrice,
  maxPrice,
  onRangeChange,
}: D3ChartProviderProps) {
  const [state, dispatch] = useReducer(chartReducer, {
    minPrice,
    maxPrice,
    zoomLevel: 1,
    panY: 0,
    isDragging: false,
  });

  // Sync prices from parent
  useEffect(() => {
    dispatch({ type: 'SYNC_PRICES', minPrice, maxPrice });
  }, [minPrice, maxPrice]);

  const actions = useMemo(() => ({
    zoomIn: () => dispatch({ type: 'SET_ZOOM', zoom: Math.min(state.zoomLevel * 1.3, ZOOM_MAX) }),
    zoomOut: () => dispatch({ type: 'SET_ZOOM', zoom: Math.max(state.zoomLevel / 1.3, ZOOM_MIN) }),
    centerRange: () => { /* Calculate optimal zoom/pan for current range */ },
    handleRangeChange: (min: number, max: number, { isDragging }: { isDragging: boolean }) => {
      dispatch({ type: 'SET_DRAGGING', isDragging });
      if (!isDragging) {
        onRangeChange(min, max); // Only notify parent on drag end
      }
    },
  }), [state.zoomLevel, onRangeChange]);

  return (
    <ChartContext.Provider value={{ state, dispatch, actions }}>
      {children}
    </ChartContext.Provider>
  );
}
```

---

## Part 8: Main Orchestrator Component

```typescript
// D3LiquidityRangeChart.tsx

export function D3LiquidityRangeChart({
  poolId,
  token0Symbol,
  token1Symbol,
  currentPoolTick,
  currentPrice,
  minPrice,
  maxPrice,
  onRangeChange,
  tickSpacing,
}: D3LiquidityRangeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const renderersRef = useRef<Renderers | null>(null);

  const dimensions = useResponsiveDimensions();

  // Fetch price data
  const { entries: priceData, loading: priceLoading } = usePoolPriceChartData({
    variables: { poolId, token0: token0Symbol, token1: token1Symbol, duration: HistoryDuration.MONTH },
    priceInverted: false, // Handle inversion in renderer
  });

  // Fetch liquidity data (reuse existing pattern)
  const { liquidityData, loading: liquidityLoading } = useLiquidityData(poolId);

  // Initialize renderers
  useEffect(() => {
    if (!svgRef.current || !dimensions.isInitialized) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('g').remove();

    const mainGroup = svg.append('g');

    // Create scale functions
    const { priceToY, yToPrice, tickScale } = createScales({
      liquidityData,
      dimensions,
      zoomLevel: 1,
      panY: 0,
    });

    // Initialize all renderers
    renderersRef.current = {
      priceLine: createPriceLineRenderer({ g: mainGroup, dimensions, getState }),
      liquidityBars: createLiquidityBarsRenderer({ g: mainGroup, dimensions, getState }),
      rangeArea: createRangeAreaRenderer({ g: mainGroup, dimensions, getState }),
      minMaxLines: createMinMaxLinesRenderer({ g: mainGroup, dimensions, getState, onRangeChange }),
      rangeHandles: createRangeHandlesRenderer({ g: mainGroup, dimensions, getState, onRangeChange }),
      currentPrice: createCurrentPriceRenderer({ g: mainGroup, dimensions, getState }),
    };

    // Initial draw
    drawAll();

    return () => {
      renderersRef.current = null;
    };
  }, [dimensions, liquidityData]);

  // Redraw when range changes
  useEffect(() => {
    if (renderersRef.current) {
      drawAll();
    }
  }, [minPrice, maxPrice, priceData]);

  const drawAll = useCallback(() => {
    if (!renderersRef.current) return;

    const { priceToY, yToPrice, tickScale } = createScales({
      liquidityData,
      dimensions,
      zoomLevel: 1,
      panY: 0,
    });

    renderersRef.current.priceLine.draw(priceData, priceToY);
    renderersRef.current.liquidityBars.draw(liquidityData, tickScale);
    renderersRef.current.rangeArea.draw(priceToY);
    renderersRef.current.minMaxLines.draw(priceToY, yToPrice);
    renderersRef.current.rangeHandles.draw(priceToY, yToPrice);
    renderersRef.current.currentPrice.draw(priceToY, currentPrice);
  }, [priceData, liquidityData, dimensions, currentPrice]);

  if (priceLoading || liquidityLoading) {
    return <ChartSkeleton />;
  }

  return (
    <div className="relative h-[200px] w-full">
      <svg
        ref={svgRef}
        width="100%"
        height={CHART_DIMENSIONS.CHART_HEIGHT}
        className="touch-manipulation"
      />
      {/* Zoom controls overlay */}
      <ChartControls onZoomIn={actions.zoomIn} onZoomOut={actions.zoomOut} onCenter={actions.centerRange} />
    </div>
  );
}
```

---

## Part 9: Integration with RangeAndAmountsStep

Replace the current `InteractiveRangeChart` usage:

```typescript
// In RangeAndAmountsStep.tsx

// Before (current):
<InteractiveRangeChart
  selectedPoolId={poolId}
  token0Symbol={poolConfig.currency0.symbol}
  token1Symbol={poolConfig.currency1.symbol}
  currentPoolTick={currentPoolTick}
  currentPrice={formattedCurrentPrice}
  currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
  tickLower={tickLower}
  tickUpper={tickUpper}
  xDomain={xDomain}
  onRangeChange={handleRangeChange}
  sdkMinTick={sdkMinTick}
  sdkMaxTick={sdkMaxTick}
  defaultTickSpacing={tickSpacing}
/>

// After (new D3 chart):
<D3LiquidityRangeChart
  poolId={poolId}
  token0Symbol={poolConfig.currency0.symbol}
  token1Symbol={poolConfig.currency1.symbol}
  currentPoolTick={currentPoolTick}
  currentPrice={formattedCurrentPrice}
  minPrice={displayMinPrice}
  maxPrice={displayMaxPrice}
  onRangeChange={(min, max) => {
    // Convert price back to ticks
    const newTickLower = priceToTick(min);
    const newTickUpper = priceToTick(max);
    handleRangeChange(newTickLower.toString(), newTickUpper.toString());
  }}
  tickSpacing={tickSpacing}
/>
```

---

## Part 10: Implementation Order

### Phase 1: Foundation (Day 1-2)
1. Create file structure
2. Implement constants and types
3. Create `useResponsiveDimensions` hook
4. Create scale utilities (`priceToY`, `yToPrice`, `tickScale`)

### Phase 2: Basic Rendering (Day 2-3)
1. Implement `LiquidityBarsRenderer` (reuse existing data fetch)
2. Implement `PriceLineRenderer` (reuse existing hook)
3. Implement `CurrentPriceRenderer`
4. Test static rendering

### Phase 3: Range Selection (Day 3-4)
1. Implement `RangeAreaRenderer`
2. Implement `MinMaxLinesRenderer`
3. Implement `RangeHandlesRenderer`
4. Test visual elements without drag

### Phase 4: Interactions (Day 4-5)
1. Implement `createHandleDragBehavior`
2. Implement `createCenterDragBehavior`
3. Wire up drag behaviors to renderers
4. Test drag interactions

### Phase 5: Polish & Integration (Day 5-6)
1. Add zoom/pan controls
2. Implement `useChartInteractions` (wheel events)
3. Integrate with `RangeAndAmountsStep`
4. Test full flow
5. Polish animations and transitions

---

## Key Differences from Uniswap

| Aspect | Uniswap | Alphix |
|--------|---------|--------|
| State Management | Full Zustand store with 9 actions | React Context + useReducer |
| Renderers | 9 separate renderers | 6 consolidated renderers |
| Color System | Spore tokens (Tamagui) | CSS variables (Tailwind) |
| Price Axis | Tick-based scaleBand | Price-based scaleLinear |
| Animation | requestAnimationFrame loop | CSS transitions where possible |
| TypeScript | Full types | Full types |

---

## Testing Checklist

- [ ] Chart renders with correct dimensions
- [ ] Price line shows historical data
- [ ] Liquidity bars display correctly
- [ ] Range area highlights selected range
- [ ] Min/max handles are draggable
- [ ] Center handle moves entire range
- [ ] Handles swap when crossed
- [ ] Minimum range height is enforced
- [ ] Current price indicator shows correct position
- [ ] Color changes based on in-range/out-of-range
- [ ] Zoom in/out works
- [ ] Pan works
- [ ] Integration with wizard step works
- [ ] Mobile touch events work
- [ ] Performance is acceptable with 500+ ticks
