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

export function usePoolStats(poolId: string) {
  return useQuery({
    queryKey: qk.poolStats(poolId),
    queryFn: async () => {
      const resp = await fetch('/api/liquidity/get-pools-batch', { cache: 'no-store' as any } as any)
      if (!resp.ok) throw new Error('Failed to load pool stats')
      const json = await resp.json()
      const arr = Array.isArray(json?.pools) ? json.pools : []
      const idLc = String(poolId || '').toLowerCase()
      const m = arr.find((p: any) => String(p?.poolId || '').toLowerCase() === idLc)
      return m || null
    },
    staleTime: 60 * 60 * 1000, // 1 hour (your recommendation)
    gcTime: 6 * 60 * 60 * 1000, // 6 hours GC
    enabled: typeof poolId === 'string' && poolId.length > 0,
  })
}

export function usePoolChart(poolId: string, days: number = 60) {
  return useQuery({
    queryKey: qk.poolChart(poolId, days),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/chart-volume?poolId=${encodeURIComponent(poolId)}&days=${days}`, { cache: 'no-store' as any } as any)
      if (!resp.ok) throw new Error('Failed to load chart data')
      return resp.json()
    },
    staleTime: 6 * 60 * 60 * 1000, // 6 hours (your recommendation)
    gcTime: 24 * 60 * 60 * 1000, // 24 hours GC
    enabled: !!poolId,
  })
}

export function useDynamicFeeHistory(poolId: string, days: number = 60) {
  return useQuery({
    queryKey: qk.dynamicFeeHistory(poolId, days),
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(poolId)}&days=${days}`, { cache: 'no-store' as any } as any)
      if (!resp.ok) throw new Error('Failed to load dynamic fee history')
      return resp.json()
    },
    staleTime: 6 * 60 * 60 * 1000, // 6 hours (consistent with chart data)
    gcTime: 24 * 60 * 60 * 1000,
    enabled: !!poolId,
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

export function useUncollectedFees(positionId: string, ttlMs: number = 60_000) {
  return useQuery({
    queryKey: qk.uncollectedFees(positionId),
    queryFn: async () => {
      const cache = await import('@/lib/client-cache')
      return cache.loadUncollectedFees(positionId, ttlMs)
    },
    staleTime: ttlMs,
    gcTime: Math.max(ttlMs * 10, 10 * 60 * 1000),
    enabled: typeof positionId === 'string' && positionId.length > 0,
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
      const resp = await fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(poolId)}`, { cache: 'no-store' as any } as any)
      if (!resp.ok) throw new Error('Failed to load pool state')
      return resp.json()
    },
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    enabled: !!poolId && poolId.length > 0,
  })
}

export function useDynamicFeeNow(poolId: string) {
  return useQuery({
    queryKey: qk.dynamicFeeNow(poolId),
    queryFn: async () => {
      // Reuse get-dynamic-fee by deriving tokens from pool config server-side if needed later
      const resp = await fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(poolId)}`, { cache: 'no-store' as any } as any)
      if (!resp.ok) throw new Error('Failed to load current fee context')
      const json = await resp.json()
      // It includes lpFee in millionths; return bps for consistency
      const lpFeeMillionths = Number(json?.lpFee)
      const bps = Math.max(0, Math.round((lpFeeMillionths / 1_000_000) * 10_000))
      return { dynamicFeeBps: bps }
    },
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    enabled: !!poolId,
  })
}

export function useQuote(params: { from: string; to: string; amount: string; swapType?: 'ExactIn' | 'ExactOut'; chainId: number; enabled?: boolean }) {
  const { from, to, amount, swapType = 'ExactIn', chainId, enabled = true } = params
  return useQuery({
    queryKey: qk.quote(from, to, amount),
    queryFn: async ({ signal }) => {
      const controller = new AbortController()
      const resp = await fetch('/api/swap/get-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTokenSymbol: from, toTokenSymbol: to, amountDecimalsStr: amount, swapType, chainId }),
        signal: signal ?? controller.signal,
      } as any)
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}))
        throw new Error(j?.message || 'Failed to get quote')
      }
      return resp.json()
    },
    enabled: Boolean(enabled && from && to && amount),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
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



