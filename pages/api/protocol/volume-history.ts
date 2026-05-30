/**
 * Protocol Volume History API
 *
 * Proxies to backend GET /protocol/volume/history
 * Returns daily aggregate 24h swap volume across all pools and networks for the past 30 days.
 */

import { createProtocolHistoryHandler } from '@/lib/api/protocol-history-handler'

interface VolumeHistoryPoint {
  timestamp: number
  volume24hUsd: number
}

export default createProtocolHistoryHandler<VolumeHistoryPoint>({
  upstreamPath: '/protocol/volume/history',
  cacheKey: 'protocol:volume-history',
  logTag: 'volume-history',
  errorMessage: 'Failed to fetch volume history',
})
