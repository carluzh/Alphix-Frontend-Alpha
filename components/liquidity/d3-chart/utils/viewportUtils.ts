/**
 * D3 Liquidity Range Chart - Viewport Utilities
 *
 * Copied from Uniswap's rangeViewportUtils.ts and chartUtils.ts
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart/utils/rangeViewportUtils.ts
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart/utils/chartUtils.ts
 */

import { CHART_BEHAVIOR, CHART_DIMENSIONS } from '../constants'
import type { ChartEntry, PriceDataPoint } from '../types'

/**
 * Calculate dynamic minimum zoom to fit all liquidity bars
 * @see Uniswap chartUtils.ts
 */
export const calculateDynamicZoomMin = (liquidityDataLength: number): number => {
  if (liquidityDataLength === 0) {
    return CHART_BEHAVIOR.ZOOM_MIN
  }

  const barHeight = CHART_DIMENSIONS.LIQUIDITY_BAR_HEIGHT + CHART_DIMENSIONS.LIQUIDITY_BAR_SPACING
  const totalContentHeight = liquidityDataLength * barHeight
  const viewportHeight = CHART_DIMENSIONS.CHART_HEIGHT

  const calculatedMin = viewportHeight / totalContentHeight

  return Math.max(CHART_BEHAVIOR.ZOOM_MIN, calculatedMin)
}

/**
 * Get closest tick to a price
 * @see Uniswap getClosestTick.ts
 */
export function getClosestTick(liquidityData: ChartEntry[], price: number): { tick: ChartEntry; index: number } {
  const currentTickIndex = liquidityData.findIndex(
    (d) => Math.abs(d.price0 - price) === Math.min(...liquidityData.map((item) => Math.abs(item.price0 - price))),
  )

  return { tick: liquidityData[currentTickIndex], index: currentTickIndex }
}

/**
 * Calculates zoom and pan parameters to fit a price range in the viewport
 * @see Uniswap rangeViewportUtils.ts
 */
export const calculateRangeViewport = ({
  minTickIndex,
  maxTickIndex,
  liquidityData,
  dynamicZoomMin,
  dimensions,
}: {
  minTickIndex: number
  maxTickIndex: number
  liquidityData: ChartEntry[]
  dynamicZoomMin: number
  dimensions: { width: number; height: number }
}) => {
  // Calculate the range in tick space
  const rangeCenterIndex = (minTickIndex + maxTickIndex) / 2
  const rangeSpanInTicks = Math.abs(maxTickIndex - minTickIndex) || liquidityData.length

  // Calculate zoom level to fit the range in viewport with padding
  const viewportHeight = dimensions.height
  const barHeight = CHART_DIMENSIONS.LIQUIDITY_BAR_HEIGHT + CHART_DIMENSIONS.LIQUIDITY_BAR_SPACING
  const ticksVisibleInViewport = viewportHeight / barHeight
  const paddingFactor = 1.25 // Show 25% more than the range for context
  const requiredTicks = rangeSpanInTicks * paddingFactor

  // Calculate zoom: if we need to show more ticks than viewport can handle at 1x,
  // we need to zoom OUT (zoom < 1), but not below dynamicZoomMin
  const targetZoom = Math.max(Math.min(ticksVisibleInViewport / requiredTicks, CHART_BEHAVIOR.ZOOM_MAX), dynamicZoomMin)

  // Calculate panY to center the range with the new zoom level
  const rangeCenterY = (liquidityData.length - 1 - rangeCenterIndex) * barHeight * targetZoom
  const targetPanY = viewportHeight / 2 - rangeCenterY

  return {
    targetZoom,
    targetPanY,
  }
}

/**
 * Calculates bounded panY to prevent liquidity bars from underflowing the viewport
 * @see Uniswap boundPanY.ts
 */
export function boundPanY({
  panY,
  viewportHeight,
  liquidityData,
  zoomLevel,
}: {
  panY: number
  viewportHeight: number
  liquidityData: ChartEntry[]
  zoomLevel: number
}) {
  const totalContentHeight =
    liquidityData.length * CHART_DIMENSIONS.LIQUIDITY_BAR_HEIGHT +
    (liquidityData.length - 1) * CHART_DIMENSIONS.LIQUIDITY_BAR_SPACING
  const totalContentHeightWithZoom = totalContentHeight * zoomLevel

  // Apply bounds: content should not go below viewport bottom or above viewport top
  const minPanY = Math.min(0, viewportHeight - totalContentHeightWithZoom)
  const maxPanY = 0

  return Math.max(minPanY, Math.min(maxPanY, panY))
}

/**
 * Get min/max bounds from price data
 * @see Uniswap PriceChart utils getCandlestickPriceBounds
 */
export function getPriceDataBounds(priceData: PriceDataPoint[]): { min: number; max: number } {
  if (!priceData || priceData.length === 0) {
    return { min: 0, max: 0 }
  }

  let min = Infinity
  let max = -Infinity

  for (const point of priceData) {
    if (point.value < min) min = point.value
    if (point.value > max) max = point.value
  }

  return { min, max }
}
