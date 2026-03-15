/**
 * D3 Liquidity Range Chart - Types
 *
 * TypeScript interfaces for the D3 chart components.
 */


// Re-export ChartEntry from existing types (or define inline if needed)
export interface ChartEntry {
  tick: number;
  price0: number;
  price1: number;
  activeLiquidity: number;
  liquidity?: number;
}

// Price data point (from usePoolPriceChartData)
export interface PriceDataPoint {
  time: number; // Unix timestamp in seconds
  value: number;
}

// Chart dimensions
export interface ChartDimensions {
  width: number;
  height: number;
}

// Tick alignment for priceToY conversion
export type TickAlignment = 'center' | 'top' | 'bottom';

// D3 tick scale type - custom wrapper around ScaleBand
export interface TickScale {
  (tick: string): number | undefined;
  domain(): string[];
  bandwidth(): number;
  range(): [number, number];
}

// Price to Y conversion function type
export type PriceToYFn = (params: {
  price: number;
  tickAlignment?: TickAlignment;
}) => number;

// Y to Price conversion function type
export type YToPriceFn = (y: number) => number;

// Renderer interface - each renderer has a draw method
export interface Renderer {
  draw(): void;
}


// Chart state
export interface ChartState {
  dimensions: ChartDimensions;
  minPrice?: number;
  maxPrice?: number;
  currentPrice?: number;
  zoomLevel: number;
  panY: number;
  isDragging: boolean;
  isFullRange: boolean;
  // Hover state
  isChartHovered: boolean;
  hoveredY?: number;
  hoveredTick?: ChartEntry;
  // Drag state for range creation
  dragStartY: number | null;
  dragCurrentY?: number;
  dragStartTick?: ChartEntry;
  dragCurrentTick?: ChartEntry;
}

// Chart actions
export interface ChartActions {
  setMinPrice: (price: number) => void;
  setMaxPrice: (price: number) => void;
  setRange: (minPrice: number, maxPrice: number) => void;
  setZoomLevel: (zoom: number) => void;
  setPanY: (panY: number) => void;
  setIsDragging: (isDragging: boolean) => void;
  setHoveredTick: (tick?: ChartEntry) => void;
  // New actions for hover/drag state
  setChartState: (updates: Partial<ChartState>) => void;
  handlePriceChange: (type: 'min' | 'max', price: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  centerRange: () => void;
  drawAll: () => void;
}



// Drag behavior types
export type HandleType = 'min' | 'max' | 'center';


