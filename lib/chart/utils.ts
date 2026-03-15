/**
 * Chart utilities - Matching Uniswap's implementation 1:1
 * @see interface/apps/web/src/utils/prices.ts
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts
 */

import { PriceChartData } from './types'

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

