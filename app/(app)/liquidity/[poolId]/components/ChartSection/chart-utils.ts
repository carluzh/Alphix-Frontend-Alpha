export const PDP_CHART_HEIGHT_PX = 300; // Match PortfolioChart height

// Colors matching page.old.tsx
export const CHART_COLORS = {
  activity: "hsl(var(--chart-3))",
  target: "hsl(var(--chart-2))",
  fee: "#e85102",
  buyFee: "hsl(142.1 76.2% 36.3%)",  // custom-green
  sellFee: "hsl(0 84.2% 60.2%)",       // custom-red
  volatility: "#a0a0a0",
  bar: "#404040",
};

// Dot pattern for chart background (matches PortfolioChart)
export const DOT_PATTERN = {
  color: "#333333",
  size: "1px",
  spacing: "24px",
};

// Axis dimensions for pattern overlay positioning (matches PatternOverlay.tsx)
export const TIME_SCALE_HEIGHT = 26; // Height of x-axis labels
export const PRICE_SCALE_WIDTH = 55; // Width of y-axis labels
export const CHART_DATA_PADDING = 10; // Padding between chart data and Y-axis (via XAxis padding)

// Background color for the dot border (matches LiveDotRenderer)
export const SURFACE1_COLOR = "hsl(0 0% 7%)";

/**
 * Format fee value with proper decimal places
 * 2 decimals if >= 0.3, 3 if >= 0.05, 4 else
 */
export function formatFeeValue(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 0.3) return value.toFixed(2);
  if (absValue >= 0.05) return value.toFixed(3);
  if (absValue >= 0.0005) return value.toFixed(4);
  return value.toFixed(5);
}
