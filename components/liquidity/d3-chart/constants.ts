/**
 * D3 Liquidity Range Chart - Constants
 *
 * Inspired by Uniswap's D3LiquidityRangeChart but adapted for Alphix styling.
 * Uses CSS variables from globals.css for consistency.
 */

// Chart dimension constants
export const CHART_DIMENSIONS = {
  // Main chart
  CHART_HEIGHT: 200,
  LIQUIDITY_SECTION_WIDTH: 120,
  TIMESCALE_HEIGHT: 20,
  RANGE_INDICATOR_WIDTH: 16,
  LIQUIDITY_SECTION_OFFSET: 17, // RANGE_INDICATOR_WIDTH + 1

  // Bars (matching Uniswap)
  LIQUIDITY_BAR_HEIGHT: 3,
  LIQUIDITY_BAR_SPACING: 1,

  // Lines and handles
  SOLID_LINE_HEIGHT: 3,
  TRANSPARENT_LINE_HEIGHT: 30, // Invisible drag target
  HANDLE_RADIUS: 6,
  CENTER_HANDLE_WIDTH: 12,
  CENTER_HANDLE_HEIGHT: 6,
  PRICE_DOT_RADIUS: 4,

  // Constraints
  RANGE_MIN_HEIGHT: 40, // Minimum distance between handles
  DRAG_BOUNDARY_MARGIN: 10, // Allow dragging slightly beyond edges
} as const;

// Chart behavior constants
export const CHART_BEHAVIOR = {
  // Zoom
  ZOOM_MIN: 0.5,
  ZOOM_MAX: 3,
  ZOOM_FACTOR: 1.3,

  // Animation
  ANIMATION_DURATION: 200,

  // Pinch (touch)
  PINCH_DELTA_SCALE: 0.02,
  PINCH_ZOOM_FACTOR_MIN: 0.5,
  PINCH_ZOOM_FACTOR_MAX: 2.0,
} as const;

// Color scheme - using actual values (SVG attributes can't resolve CSS variables)
// Alphix orange: #e85102 / hsl(21, 96%, 46%)
export const CHART_COLORS = {
  // Range indicators (accent/primary color - orange)
  rangeActive: '#e85102',
  rangeActiveOpacity: 0.3,

  // Liquidity bars
  barsInRange: '#e85102',
  barsInRangeOpacity: 0.6,
  barsOutOfRange: '#525252',
  barsOutOfRangeOpacity: 0.3,

  // Price line
  priceLineInRange: '#e85102',
  priceLineOutOfRange: '#6b7280',

  // Current price
  currentPriceLine: '#9ca3af',
  currentPriceDot: '#e85102',

  // Handles
  handleFill: '#ffffff',
  handleStroke: 'rgba(0, 0, 0, 0.15)',
  handleShadow: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15))',

  // Grid/background
  gridLine: 'rgba(255, 255, 255, 0.05)',
  chartBackground: 'rgba(255, 255, 255, 0.02)',
} as const;

// CSS class names for D3 elements
export const CHART_CLASSES = {
  // Groups
  PRICE_LINE_GROUP: 'price-line-group',
  LIQUIDITY_BARS_GROUP: 'liquidity-bars-group',
  RANGE_AREA_GROUP: 'range-area-group',
  MIN_MAX_LINES_GROUP: 'min-max-lines-group',
  RANGE_INDICATORS_GROUP: 'range-indicators-group',
  CURRENT_PRICE_GROUP: 'current-price-group',

  // Elements
  LIQUIDITY_BAR: 'liquidity-bar',
  PRICE_LINE: 'price-line',
  MIN_LINE: 'min-price-line',
  MAX_LINE: 'max-price-line',
  RANGE_INDICATOR: 'range-indicator',
  MIN_HANDLE: 'min-handle',
  MAX_HANDLE: 'max-handle',
  CENTER_HANDLE: 'center-handle',
  CURRENT_PRICE_DOT: 'current-price-dot',
} as const;
