/**
 * Protocol User Revenue History API
 *
 * Proxies to backend GET /protocol/user-revenue/history
 * Returns daily cumulative LP revenue (fees) across all pools and networks for the past 30 days.
 * Monotonically non-decreasing.
 */

import { createProtocolHistoryHandler } from '@/lib/api/protocol-history-handler'

interface UserRevenueHistoryPoint {
  timestamp: number
  userRevenueUsd: number
}

export default createProtocolHistoryHandler<UserRevenueHistoryPoint>({
  upstreamPath: '/protocol/user-revenue/history',
  cacheKey: 'protocol:user-revenue-history',
  logTag: 'user-revenue-history',
  errorMessage: 'Failed to fetch user revenue history',
})
