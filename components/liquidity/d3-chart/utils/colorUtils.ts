/**
 * D3 Liquidity Range Chart - Color Utilities
 *
 * Functions to determine colors and opacity based on price range.
 */

import { CHART_COLORS } from '../constants';

/**
 * Get color for a price value based on whether it's in the selected range.
 */
export function getColorForPrice({
  value,
  minPrice,
  maxPrice,
  activeColor = CHART_COLORS.barsInRange,
  inactiveColor = CHART_COLORS.barsOutOfRange,
}: {
  value: number;
  minPrice?: number;
  maxPrice?: number;
  activeColor?: string;
  inactiveColor?: string;
}): string {
  if (minPrice !== undefined && maxPrice !== undefined) {
    const isInRange = value >= minPrice && value <= maxPrice;
    return isInRange ? activeColor : inactiveColor;
  }
  return inactiveColor;
}

/**
 * Get opacity for a price value based on whether it's in the selected range.
 */
export function getOpacityForPrice({
  value,
  minPrice,
  maxPrice,
  activeOpacity = CHART_COLORS.barsInRangeOpacity,
  inactiveOpacity = CHART_COLORS.barsOutOfRangeOpacity,
}: {
  value: number;
  minPrice?: number;
  maxPrice?: number;
  activeOpacity?: number;
  inactiveOpacity?: number;
}): number {
  if (minPrice !== undefined && maxPrice !== undefined) {
    const isInRange = value >= minPrice && value <= maxPrice;
    return isInRange ? activeOpacity : inactiveOpacity;
  }
  return inactiveOpacity;
}
