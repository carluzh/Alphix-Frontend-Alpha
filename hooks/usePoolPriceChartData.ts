/**
 * Pool Price Chart Data Hook
 *
 * Fetches and transforms pool price history for chart display.
 * Matches Uniswap's implementation pattern 1:1.
 *
 * @see interface/apps/web/src/hooks/usePoolPriceChartData.tsx
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import {
  ChartQueryResult,
  ChartType,
  DataQuality,
  HistoryDuration,
  PriceChartData,
  TimestampedPoolPrice,
} from '@/lib/chart/types'
import { removeOutliers } from '@/lib/chart/utils'

/**
 * Create a simple hash from chart entries to detect data changes.
 * Used to prevent unnecessary re-renders when data hasn't changed.
 */
function hashEntries(entries: PriceChartData[]): string {
  if (entries.length === 0) return ''
  // Simple hash based on first, last, and length
  const first = entries[0]
  const last = entries[entries.length - 1]
  return `${entries.length}-${first.time}-${first.value}-${last.time}-${last.value}`
}

interface PoolPriceChartVars {
  poolId?: string
  token0?: string
  token1?: string
  duration?: HistoryDuration
}

interface ApiResponse {
  data: TimestampedPoolPrice[]
  source: 'uniswap' | 'coingecko'
  cached?: boolean
}

/**
 * Hook for fetching pool price chart data
 *
 * @param variables - Pool identifiers and duration
 * @param priceInverted - If true, use token0Price; if false, use token1Price
 * @returns ChartQueryResult with transformed price data
 *
 * @example
 * const { entries, loading, dataQuality } = usePoolPriceChartData({
 *   variables: { poolId: '0x...', token0: 'ETH', token1: 'USDC', duration: 'WEEK' },
 *   priceInverted: false,
 * })
 */
export function usePoolPriceChartData({
  variables,
  priceInverted = false,
}: {
  variables?: PoolPriceChartVars
  priceInverted: boolean
}): ChartQueryResult<PriceChartData, ChartType.PRICE> {
  const { poolId, token0, token1, duration = HistoryDuration.WEEK } = variables ?? {}

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ['pool', 'priceHistory', poolId, duration],
    queryFn: async ({ signal }) => {
      if (!poolId || !token0 || !token1) {
        return { data: [], source: 'coingecko' as const }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      try {
        const url = `/api/liquidity/pool-price-history?poolId=${poolId}&token0=${token0}&token1=${token1}&duration=${duration}`
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        return await response.json()
      } catch (error) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Request timed out')
        }
        throw error
      }
    },
    enabled: !!poolId && !!token0 && !!token1,
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 10 * 60 * 1000,    // 10 minutes
    retry: 1,
  })

  return useMemo(() => {
    const priceHistory = data?.data ?? []

    // Transform to PriceChartData format
    // @see interface/apps/web/src/hooks/usePoolPriceChartData.tsx:35-49
    const entries = priceHistory
      .filter((price): price is TimestampedPoolPrice => price !== undefined)
      .map((price) => {
        // Use token0Price if inverted, token1Price otherwise
        const value = priceInverted ? price.token0Price : price.token1Price

        return {
          time: price.timestamp as UTCTimestamp,
          value,
          open: value,
          high: value,
          low: value,
          close: value,
        }
      })

    // Apply IQR outlier removal
    const filteredEntries = removeOutliers(entries)

    // Determine data quality
    const dataQuality = isLoading || !priceHistory.length
      ? DataQuality.INVALID
      : DataQuality.VALID

    return {
      chartType: ChartType.PRICE,
      entries: filteredEntries,
      loading: isLoading,
      dataQuality,
      dataHash: hashEntries(filteredEntries),
    }
  }, [data?.data, isLoading, priceInverted])
}

