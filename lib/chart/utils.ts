/**
 * Chart utilities - Matching Uniswap's implementation 1:1
 * @see interface/apps/web/src/utils/prices.ts
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts
 */

import type { UTCTimestamp } from 'lightweight-charts'
import { HistoryDuration, PriceChartData } from './types'

/**
 * Convert a timestamp field to UTCTimestamp for lightweight-charts
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts:71-73
 */
export function withUTCTimestamp<T extends { timestamp: number }>(
  entry: T
): T & { time: UTCTimestamp } {
  return { ...entry, time: entry.timestamp as UTCTimestamp }
}

/**
 * Removes outliers from price data using the Interquartile Range (IQR) method
 * @param entries Array of price data points
 * @returns Filtered array with outliers removed
 * @see interface/apps/web/src/utils/prices.ts:113-133
 */
export function removeOutliers(entries: PriceChartData[]): PriceChartData[] {
  if (entries.length < 4) {
    return entries
  }

  const values = entries.map((entry) => entry.value).sort((a, b) => a - b)

  const q1Index = Math.floor(values.length * 0.25)
  const q3Index = Math.floor(values.length * 0.75)
  const q1 = values[q1Index]
  const q3 = values[q3Index]

  const iqr = q3 - q1
  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr

  return entries.filter((entry) => {
    const value = entry.value
    return value >= lowerBound && value <= upperBound
  })
}

/**
 * Get price bounds from an array of price points
 * @see interface/apps/web/src/components/Charts/PriceChart/utils.ts:8-26
 */
export function getPriceBounds(prices: { value: number }[]): { min: number; max: number } {
  if (!prices.length) {
    return { min: 0, max: 0 }
  }

  let min = prices[0].value
  let max = prices[0].value

  for (const pricePoint of prices) {
    if (pricePoint.value < min) {
      min = pricePoint.value
    }
    if (pricePoint.value > max) {
      max = pricePoint.value
    }
  }

  return { min, max }
}

/**
 * Check if a price range has low variance (stablecoin-like)
 * @see interface/packages/uniswap/src/components/charts/utils.ts:12-34
 */
const STABLECOIN_VARIANCE_PERCENT_THRESHOLD = 0.5

export function isLowVarianceRange({
  min,
  max,
  duration,
}: {
  min: number
  max: number
  duration?: HistoryDuration
}): boolean {
  if (min <= 0) {
    return false
  }

  // Always return false for 1H time windows
  if (duration === HistoryDuration.HOUR) {
    return false
  }

  const priceRange = max - min
  const priceVariancePercent = (priceRange / min) * 100

  return priceVariancePercent < STABLECOIN_VARIANCE_PERCENT_THRESHOLD
}
