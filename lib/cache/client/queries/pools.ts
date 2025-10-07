/**
 * React Query hooks for pool data
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '../query-keys'
import { STALE_TIMES, GC_TIMES } from '../query-client'
import type { Pool } from '@/types'

interface PoolsBatchResponse {
  success: boolean
  pools: Array<{
    poolId: string
    tvlUSD: number
    tvlYesterdayUSD?: number
    volume24hUSD: number
    volumePrev24hUSD?: number
  }>
  timestamp: number
}

/**
 * Fetch all pools with stats (batch)
 */
export function usePoolsBatch(): UseQueryResult<PoolsBatchResponse> {
  return useQuery({
    queryKey: queryKeys.pools.batch(),
    queryFn: async () => {
      // Get current version from server
      const versionResp = await fetch('/api/cache-version', {
        cache: 'no-store' as any,
      } as any)

      if (!versionResp.ok) {
        throw new Error('Failed to fetch cache version')
      }

      const { cacheUrl } = await versionResp.json()

      // Fetch batch data with version
      const resp = await fetch(cacheUrl, {
        cache: 'no-store' as any,
      } as any)

      if (!resp.ok) {
        throw new Error(`Failed to fetch pools batch: ${resp.status}`)
      }

      return await resp.json()
    },
    staleTime: STALE_TIMES.NORMAL, // 30 seconds
    gcTime: GC_TIMES.MEDIUM, // 30 minutes
    refetchOnWindowFocus: true,
  })
}

/**
 * Fetch individual pool stats
 */
export function usePoolStats(poolId: string): UseQueryResult<any> {
  return useQuery({
    queryKey: queryKeys.pools.stats(poolId),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-pool-stats?poolId=${poolId}`)

      if (!resp.ok) {
        throw new Error(`Failed to fetch pool stats: ${resp.status}`)
      }

      return await resp.json()
    },
    enabled: !!poolId,
    staleTime: STALE_TIMES.NORMAL,
    gcTime: GC_TIMES.MEDIUM,
  })
}

/**
 * Fetch pool state (current tick, liquidity, etc.)
 */
export function usePoolState(poolId: string): UseQueryResult<any> {
  return useQuery({
    queryKey: queryKeys.pools.state(poolId),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-pool-state?poolId=${poolId}`)

      if (!resp.ok) {
        throw new Error(`Failed to fetch pool state: ${resp.status}`)
      }

      return await resp.json()
    },
    enabled: !!poolId,
    staleTime: STALE_TIMES.REAL_TIME, // Always fresh for current state
    gcTime: GC_TIMES.SHORT,
    refetchInterval: 12000, // Poll every 12 seconds for real-time updates
  })
}

/**
 * Fetch pool chart data
 */
export function usePoolChart(
  poolId: string,
  days = 7
): UseQueryResult<any> {
  return useQuery({
    queryKey: queryKeys.pools.chart(poolId, days),
    queryFn: async () => {
      const resp = await fetch(
        `/api/liquidity/get-pool-chart?poolId=${poolId}&days=${days}`
      )

      if (!resp.ok) {
        throw new Error(`Failed to fetch pool chart: ${resp.status}`)
      }

      return await resp.json()
    },
    enabled: !!poolId,
    staleTime: STALE_TIMES.STABLE, // 5 minutes - historical data doesn't change often
    gcTime: GC_TIMES.LONG,
  })
}

/**
 * Fetch current dynamic fee for a pool
 */
export function usePoolFee(poolId: string): UseQueryResult<number> {
  return useQuery({
    queryKey: queryKeys.pools.fee(poolId),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-dynamic-fee?poolId=${poolId}`)

      if (!resp.ok) {
        throw new Error(`Failed to fetch pool fee: ${resp.status}`)
      }

      const data = await resp.json()
      return data.feeBps
    },
    enabled: !!poolId,
    staleTime: STALE_TIMES.VOLATILE, // 15 seconds - fees can change frequently
    gcTime: GC_TIMES.SHORT,
  })
}
