/**
 * Pool Price Chart Data Hook
 *
 * Fetches and transforms pool price history for chart display.
 * Uses generated Apollo hook from graphql-codegen.
 *
 * @see interface/apps/web/src/hooks/usePoolPriceChartData.tsx
 */

import { useMemo } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import { useNetwork } from '@/lib/network-context'
import {
  useGetPoolPriceHistoryQuery,
  type Chain,
  type HistoryDuration as GqlHistoryDuration,
} from '@/lib/apollo/__generated__'
import {
  ChartQueryResult,
  ChartType,
  DataQuality,
  HistoryDuration,
  PriceChartData,
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
  const { networkMode } = useNetwork()
  const chain: Chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'
  const { poolId, duration = HistoryDuration.WEEK } = variables ?? {}
  const enabled = !!poolId && poolId.length > 0

  const { data, loading } = useGetPoolPriceHistoryQuery({
    variables: {
      chain,
      poolId: poolId ?? '',
      duration: duration as GqlHistoryDuration,
    },
    skip: !enabled,
    fetchPolicy: 'cache-and-network',
    pollInterval: 5 * 60 * 1000, // 5 minutes
  })

  return useMemo(() => {
    const priceHistory = data?.poolPriceHistory ?? []

    // Transform to PriceChartData format
    // @see interface/apps/web/src/hooks/usePoolPriceChartData.tsx:35-49
    const entries = priceHistory
      .filter((price) => price !== undefined && price !== null)
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
    const dataQuality = loading || !priceHistory.length
      ? DataQuality.INVALID
      : DataQuality.VALID

    return {
      chartType: ChartType.PRICE,
      entries: filteredEntries,
      loading,
      dataQuality,
      dataHash: hashEntries(filteredEntries),
    }
  }, [data?.poolPriceHistory, loading, priceInverted])
}

