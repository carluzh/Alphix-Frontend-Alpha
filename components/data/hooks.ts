import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/queryKeys'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { publicClient } from '@/lib/viemClient'
import { logger } from '@/lib/logger'

export function useAllPrices() {
  return useQuery({
    queryKey: qk.pricesAll,
    queryFn: async ({ signal }) => {
      const startTime = Date.now();
      try {
        const svc = await import('@/lib/price-service')
        const result = await svc.getAllTokenPrices({ signal });
        const duration = Date.now() - startTime;
        logger.performance('useAllPrices query', duration, { success: true });
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('useAllPrices query failed', error as Error, { duration });
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

export function useUserPositions(ownerAddress: string) {
  return useQuery({
    queryKey: qk.userPositions(ownerAddress || ''),
    queryFn: async () => {
      const cache = await import('@/lib/client-cache')
      // Use barrier-gated position loading to prevent cache poisoning
      const ids = await cache.loadUserPositionIds(ownerAddress)
      return cache.derivePositionsFromIds(ownerAddress, ids)
    },
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    enabled: typeof ownerAddress === 'string' && ownerAddress.length > 0,
  })
}

export function useUncollectedFeesBatch(positionIds: string[], ttlMs: number = 60_000) {
  const key = Array.isArray(positionIds) ? positionIds.slice().sort().join(',') : ''
  return useQuery({
    queryKey: qk.uncollectedFeesBatch(key),
    queryFn: async () => {
      const cache = await import('@/lib/client-cache')
      return cache.loadUncollectedFeesBatch(positionIds || [], ttlMs)
    },
    staleTime: ttlMs,
    gcTime: Math.max(ttlMs * 10, 10 * 60 * 1000),
    enabled: Array.isArray(positionIds) && positionIds.length > 0,
  })
}

export function useActivity(ownerAddress: string, first: number = 20) {
  return useQuery({
    queryKey: qk.activity(ownerAddress || '', first),
    queryFn: async () => {
      const resp = await fetch('/api/portfolio/get-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: ownerAddress, first }),
      } as any)
      if (!resp.ok) throw new Error('Failed to load activity')
      return resp.json()
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    enabled: typeof ownerAddress === 'string' && ownerAddress.length > 0,
  })
}

export function usePoolState(poolId: string) {
  return useQuery({
    queryKey: qk.poolState(poolId),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(poolId)}`)
      if (!resp.ok) throw new Error('Failed to load pool state')
      return resp.json()
    },
    staleTime: 15000,
    gcTime: 10 * 60 * 1000,
    enabled: !!poolId && poolId.length > 0,
  })
}

// Temporarily disabled - was causing excessive subgraph spam
// Pool state data doesn't need real-time updates every 10s
export function useBlockRefetch(options?: { poolIds?: string[]; onBlock?: (n?: bigint) => void }) {
  const qc = useQueryClient()
  useEffect(() => {
    let lastRefetchAt = 0
    const minIntervalMs = 60_000 // Increased to 60s to reduce spam
    const isTabVisible = () => (typeof document === 'undefined') || document.visibilityState === 'visible'

    const unwatch = publicClient.watchBlockNumber({
      onBlockNumber: (n) => {
        // Skip when tab is hidden to avoid background churn
        if (!isTabVisible()) return
        // Throttle invalidations
        const now = Date.now()
        if (now - lastRefetchAt < minIntervalMs) return
        lastRefetchAt = now

        try { options?.onBlock?.(n) } catch {}
        // Only invalidate if explicitly needed - not automatic
        // Comment out the automatic invalidations to stop subgraph spam
        /*
        for (const pid of options?.poolIds || []) {
          qc.invalidateQueries({ queryKey: qk.poolState(pid), exact: true })
          qc.invalidateQueries({ queryKey: qk.dynamicFeeNow(pid), exact: true })
        }
        */
      },
      emitOnBegin: false, // do not spam immediately on mount
    })

    return () => { try { unwatch?.() } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, JSON.stringify(options?.poolIds)])
}



