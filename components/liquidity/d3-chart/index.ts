/**
 * D3 Liquidity Range Chart - Exports
 *
 * A D3-based interactive liquidity range chart for the Add Liquidity wizard.
 */

// Main component
export { D3LiquidityRangeChart } from './D3LiquidityRangeChart';
export type { D3LiquidityRangeChartProps, D3LiquidityRangeChartHandle } from './D3LiquidityRangeChart';

// Action buttons (Uniswap pattern)
export { LiquidityRangeActionButtons } from './components/LiquidityRangeActionButtons';
export type { LiquidityRangeActionButtonsProps } from './components/LiquidityRangeActionButtons';

// Constants
export { CHART_DIMENSIONS, CHART_BEHAVIOR, CHART_COLORS, CHART_CLASSES } from './constants';

// Types
export type {
  ChartEntry,
  PriceDataPoint,
  ChartDimensions,
  TickAlignment,
  TickScale,
  PriceToYFn,
  YToPriceFn,
  Renderer,
  RenderingContext,
  ChartState,
  ChartActions,
  D3LiquidityRangeChartProps as ChartProps,
  RendererConfig,
  HandleType,
  DragBehaviorConfig,
} from './types';

// Utilities
export {
  createTickScale,
  priceToY,
  yToPrice,
  createScaleFunctions,
  findClosestTick,
  getPriceBounds,
} from './utils/scaleUtils';

export {
  getColorForPrice,
  getOpacityForPrice,
  isPriceInRange,
} from './utils/colorUtils';

export {
  createHandleDragBehavior,
  createCenterDragBehavior,
} from './utils/dragBehaviors';

// Renderers (for advanced usage/customization)
export { createLiquidityBarsRenderer } from './renderers/LiquidityBarsRenderer';
export { createPriceLineRenderer } from './renderers/PriceLineRenderer';
export { createCurrentPriceRenderer } from './renderers/CurrentPriceRenderer';
export { createRangeAreaRenderer } from './renderers/RangeAreaRenderer';
export { createMinMaxLinesRenderer } from './renderers/MinMaxLinesRenderer';
export { createRangeIndicatorsRenderer } from './renderers/RangeIndicatorsRenderer';
