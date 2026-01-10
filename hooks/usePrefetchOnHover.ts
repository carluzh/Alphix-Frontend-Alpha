'use client'

import { useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

export interface UsePrefetchOnHoverOptions {
  /** Debounce delay in ms before triggering prefetch (default: 150ms) */
  delay?: number
  /** Next.js route to prefetch */
  prefetchRoute?: string
  /** Custom data prefetch function */
  prefetchData?: () => Promise<void>
}

export interface UsePrefetchOnHoverReturn {
  /** Attach to onMouseEnter */
  onMouseEnter: () => void
  /** Attach to onMouseLeave */
  onMouseLeave: () => void
  /** Reset prefetch state (useful when data changes) */
  reset: () => void
}

/**
 * usePrefetchOnHover - Prefetch data when user hovers over an element
 *
 * Features:
 * - Debounced to avoid accidental triggers (default 150ms)
 * - Only prefetches once per element
 * - Cancels prefetch if mouse leaves before debounce completes
 * - Supports both Next.js route prefetch and custom data prefetch
 *
 * Reference: interface/apps/web/src/appGraphql/data/apollo/AdaptiveRefetch.tsx
 *
 * @example
 * ```tsx
 * const { onMouseEnter, onMouseLeave } = usePrefetchOnHover({
 *   prefetchRoute: '/liquidity/pool-123',
 *   prefetchData: () => prefetchPoolChartData('pool-123'),
 *   delay: 150,
 * })
 *
 * return (
 *   <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
 *     Pool Card
 *   </div>
 * )
 * ```
 */
export function usePrefetchOnHover(
  options: UsePrefetchOnHoverOptions
): UsePrefetchOnHoverReturn {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPrefetchedRef = useRef(false)

  const handleMouseEnter = useCallback(() => {
    // Skip if already prefetched
    if (hasPrefetchedRef.current) return

    // Check for data saver mode
    if (typeof navigator !== 'undefined') {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
      if (connection?.saveData || connection?.effectiveType === '2g') {
        return
      }
    }

    const delay = options.delay ?? 150

    timeoutRef.current = setTimeout(async () => {
      // Prefetch Next.js route (page bundle)
      if (options.prefetchRoute) {
        router.prefetch(options.prefetchRoute)
      }

      // Prefetch custom data
      if (options.prefetchData) {
        try {
          await options.prefetchData()
        } catch {
          // Silent failure - prefetch is not critical
        }
      }

      hasPrefetchedRef.current = true
    }, delay)
  }, [options, router])

  const handleMouseLeave = useCallback(() => {
    // Cancel pending prefetch if mouse leaves before debounce completes
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    hasPrefetchedRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  return {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    reset,
  }
}
