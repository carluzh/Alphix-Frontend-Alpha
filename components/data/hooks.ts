import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/queryKeys'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createNetworkClient } from '@/lib/viemClient'
import { logger } from '@/lib/logger'
import { useNetwork } from '@/lib/network-context'

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
        if (!(error instanceof Error && error.name === 'AbortError')) {
          logger.error('useAllPrices query failed', error as Error, { duration });
        }
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}

export function useUserPositions(ownerAddress: string) {
  const { chainId } = useNetwork()
  return useQuery({
    queryKey: qk.userPositions(ownerAddress || ''),
    queryFn: async () => {
      const cache = await import('@/lib/client-cache')
      const onChain = await import('@/lib/on-chain-data')
      const ids = await cache.loadUserPositionIds(ownerAddress)
      const timestamps = cache.getCachedPositionTimestamps(ownerAddress)
      return onChain.derivePositionsFromIds(ownerAddress, ids, chainId, timestamps)
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
      const resp = await fetch('/api/liquidity/get-uncollected-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionIds }),
        cache: 'no-store'
      })
      if (!resp.ok) throw new Error('Failed to load fees')
      const data = await resp.json()
      if (!data.success) throw new Error(data.error || 'Failed to load fees')
      return data.items || []
    },
    staleTime: ttlMs,
    gcTime: Math.max(ttlMs * 10, 10 * 60 * 1000),
    enabled: Array.isArray(positionIds) && positionIds.length > 0,
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
    staleTime: 45000, // 45 seconds - pool state doesn't change frequently
    gcTime: 10 * 60 * 1000,
    enabled: !!poolId && poolId.length > 0,
  })
}

export function useBlockRefetch(options?: { poolIds?: string[]; onBlock?: (n?: bigint) => void }) {
  const qc = useQueryClient()
  const { networkMode } = useNetwork()
  useEffect(() => {
    let lastRefetchAt = 0
    const minIntervalMs = 60_000
    const isTabVisible = () => (typeof document === 'undefined') || document.visibilityState === 'visible'

    const publicClient = createNetworkClient(networkMode)
    const unwatch = publicClient.watchBlockNumber({
      onBlockNumber: (n) => {
        if (!isTabVisible()) return
        const now = Date.now()
        if (now - lastRefetchAt < minIntervalMs) return
        lastRefetchAt = now
        try { options?.onBlock?.(n) } catch {}
      },
      emitOnBegin: false,
    })

    return () => { try { unwatch?.() } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, JSON.stringify(options?.poolIds), networkMode])
}
