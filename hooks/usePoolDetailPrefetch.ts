'use client'

import { useCallback } from 'react'
import { usePrefetchOnHover, type UsePrefetchOnHoverReturn } from './usePrefetchOnHover'
import { prefetchService } from '@/lib/prefetch-service'

/**
 * usePoolDetailPrefetch - Specialized hook for prefetching pool detail page data
 *
 * When user hovers over a pool card, this prefetches:
 * 1. Next.js page bundle (/liquidity/[poolId])
 * 2. Pool chart data (60 days history)
 * 3. Pool batch data (TVL, volume, fees, APR)
 *
 * @param poolId - The pool ID to prefetch data for
 * @returns Hover event handlers to attach to pool card elements
 *
 * @example
 * ```tsx
 * function PoolCard({ pool }: { pool: Pool }) {
 *   const { onMouseEnter, onMouseLeave } = usePoolDetailPrefetch(pool.id)
 *
 *   return (
 *     <Link
 *       href={`/liquidity/${pool.id}`}
 *       onMouseEnter={onMouseEnter}
 *       onMouseLeave={onMouseLeave}
 *     >
 *       {pool.name}
 *     </Link>
 *   )
 * }
 * ```
 */
export function usePoolDetailPrefetch(poolId: string): UsePrefetchOnHoverReturn {
  const prefetchData = useCallback(async () => {
    if (!poolId) return
    await prefetchService.prefetchPoolDetailData(poolId)
  }, [poolId])

  return usePrefetchOnHover({
    prefetchRoute: `/liquidity/${poolId}`,
    prefetchData,
    delay: 150,
  })
}
