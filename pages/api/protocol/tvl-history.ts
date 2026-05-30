/**
 * Protocol TVL History API
 *
 * Proxies to backend GET /protocol/tvl/history
 * Returns hourly aggregate TVL across all pools and networks for the past 30 days.
 */

import { createProtocolHistoryHandler } from '@/lib/api/protocol-history-handler'

interface TvlHistoryPoint {
  timestamp: number
  tvlUsd: number
}

export default createProtocolHistoryHandler<TvlHistoryPoint>({
  upstreamPath: '/protocol/tvl/history',
  cacheKey: 'protocol:tvl-history',
  logTag: 'tvl-history',
  errorMessage: 'Failed to fetch TVL history',
})
