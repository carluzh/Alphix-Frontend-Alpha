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

/**
 * Check if a price is within the selected range.
 */
export function isPriceInRange(
  price: number,
  minPrice?: number,
  maxPrice?: number
): boolean {
  if (minPrice === undefined || maxPrice === undefined) {
    return false;
  }
  return price >= minPrice && price <= maxPrice;
}

/**
 * Get interpolated color based on distance from range boundaries.
 * Useful for gradient effects.
 */
export function getGradientColor(
  price: number,
  minPrice: number,
  maxPrice: number,
  _inRangeColor: string,
  _outOfRangeColor: string
): string {
  const isInRange = price >= minPrice && price <= maxPrice;

  if (isInRange) {
    return CHART_COLORS.barsInRange;
  }

  return CHART_COLORS.barsOutOfRange;
}
