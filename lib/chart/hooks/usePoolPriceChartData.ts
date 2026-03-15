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
import useIsWindowVisible from '@/hooks/useIsWindowVisible'
import { usePollingIntervalByChain } from '@/hooks/usePollingIntervalByChain'
import { apolloChainForMode } from '@/lib/network-mode'
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
  networkModeOverride,
}: {
  variables?: PoolPriceChartVars
  priceInverted: boolean
  networkModeOverride?: import('@/lib/network-mode').NetworkMode
}): ChartQueryResult<PriceChartData, ChartType.PRICE> {
  const networkMode = networkModeOverride
  const chain = networkMode ? apolloChainForMode(networkMode) as Chain : undefined
  const { poolId, duration = HistoryDuration.WEEK } = variables ?? {}
  const enabled = !!poolId && poolId.length > 0 && !!networkMode

  // skip chart data requests if the window is not focused
  const isWindowVisible = useIsWindowVisible()

  // Chain-based polling interval (L2 = 3s base, x100 for chart = 300s/5 min)
  const chainPollingInterval = usePollingIntervalByChain()

  const { data, loading } = useGetPoolPriceHistoryQuery({
    variables: {
      chain: chain!,
      poolId: poolId ?? '',
      duration: duration as GqlHistoryDuration,
    },
    context: { networkMode: networkMode! },
    skip: !enabled || !isWindowVisible,
    fetchPolicy: 'cache-and-network',
    pollInterval: chainPollingInterval * 100, // ~5 minutes - chart data doesn't need frequent updates
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
    }
  }, [data?.poolPriceHistory, loading, priceInverted])
}

