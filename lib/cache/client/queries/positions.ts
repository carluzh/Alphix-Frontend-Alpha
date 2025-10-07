/**
 * React Query hooks for user position data
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { queryKeys } from '../query-keys'
import { STALE_TIMES, GC_TIMES } from '../query-client'
import {
  getFromLocalStorage,
  setToLocalStorage,
  storageKeys,
} from '../persistence'
import { waitForBarrier } from '../../coordination/barriers'
import type { ProcessedPosition } from '@/pages/api/liquidity/get-positions'

/**
 * Fetch user position IDs
 * Uses localStorage for persistence across page reloads
 */
export function useUserPositionIds(
  ownerAddress: string | undefined
): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.user.positionIds(ownerAddress || ''),
    queryFn: async () => {
      if (!ownerAddress) return []

      // Wait for any pending indexing barrier
      await waitForBarrier(ownerAddress)

      // Try localStorage first
      const storageKey = storageKeys.userPositionIds(ownerAddress)
      const cached = getFromLocalStorage<string[]>(storageKey)

      if (cached && cached.length > 0) {
        return cached
      }

      // Fetch from API
      const resp = await fetch(`/api/liquidity/get-position-ids?owner=${ownerAddress}`)

      if (!resp.ok) {
        throw new Error(`Failed to fetch position IDs: ${resp.status}`)
      }

      const data = await resp.json()
      const positionIds = data.positionIds || []

      // Persist to localStorage
      if (positionIds.length > 0) {
        setToLocalStorage(storageKey, positionIds)
      }

      return positionIds
    },
    enabled: !!ownerAddress,
    staleTime: STALE_TIMES.NORMAL, // 30 seconds
    gcTime: GC_TIMES.LONG, // Keep in memory for 24 hours
  })
}

/**
 * Fetch full user positions
 * Derives position details from position IDs
 */
export function useUserPositions(
  ownerAddress: string | undefined
): UseQueryResult<ProcessedPosition[]> {
  // First get position IDs
  const { data: positionIds } = useUserPositionIds(ownerAddress)

  return useQuery({
    queryKey: queryKeys.user.positions(ownerAddress || ''),
    queryFn: async () => {
      if (!ownerAddress || !positionIds || positionIds.length === 0) {
        return []
      }

      // Wait for any pending indexing barrier
      await waitForBarrier(ownerAddress)

      // Fetch full position details
      const resp = await fetch('/api/liquidity/derive-positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: ownerAddress, positionIds }),
      })

      if (!resp.ok) {
        throw new Error(`Failed to derive positions: ${resp.status}`)
      }

      const data = await resp.json()
      return data.positions || []
    },
    enabled: !!ownerAddress && !!positionIds && positionIds.length > 0,
    staleTime: STALE_TIMES.NORMAL, // 30 seconds
    gcTime: GC_TIMES.LONG,
  })
}

/**
 * Fetch uncollected fees for a position
 */
export function useUncollectedFees(
  positionId: string | undefined
): UseQueryResult<{ amount0: string; amount1: string }> {
  return useQuery({
    queryKey: queryKeys.user.fees('', positionId || ''), // Owner not needed for single position
    queryFn: async () => {
      if (!positionId) {
        return { amount0: '0', amount1: '0' }
      }

      const resp = await fetch(
        `/api/liquidity/get-uncollected-fees?positionId=${positionId}`
      )

      if (!resp.ok) {
        throw new Error(`Failed to fetch uncollected fees: ${resp.status}`)
      }

      return await resp.json()
    },
    enabled: !!positionId,
    staleTime: STALE_TIMES.VOLATILE, // 15 seconds - fees accrue frequently
    gcTime: GC_TIMES.SHORT,
  })
}

/**
 * Fetch uncollected fees for multiple positions (batch)
 */
export function useUncollectedFeesBatch(
  ownerAddress: string | undefined,
  positionIds: string[]
): UseQueryResult<Record<string, { amount0: string; amount1: string }>> {
  return useQuery({
    queryKey: queryKeys.user.feesBatch(ownerAddress || '', positionIds),
    queryFn: async () => {
      if (!ownerAddress || positionIds.length === 0) {
        return {}
      }

      const resp = await fetch('/api/liquidity/get-uncollected-fees-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionIds }),
      })

      if (!resp.ok) {
        throw new Error(`Failed to fetch batch fees: ${resp.status}`)
      }

      return await resp.json()
    },
    enabled: !!ownerAddress && positionIds.length > 0,
    staleTime: STALE_TIMES.VOLATILE,
    gcTime: GC_TIMES.SHORT,
  })
}

/**
 * Fetch user activity/transactions
 */
export function useUserActivity(
  ownerAddress: string | undefined,
  limit = 50
): UseQueryResult<any[]> {
  return useQuery({
    queryKey: queryKeys.user.activity(ownerAddress || '', limit),
    queryFn: async () => {
      if (!ownerAddress) return []

      const resp = await fetch(
        `/api/liquidity/get-user-activity?owner=${ownerAddress}&limit=${limit}`
      )

      if (!resp.ok) {
        throw new Error(`Failed to fetch user activity: ${resp.status}`)
      }

      const data = await resp.json()
      return data.activities || []
    },
    enabled: !!ownerAddress,
    staleTime: STALE_TIMES.NORMAL,
    gcTime: GC_TIMES.LONG,
  })
}
