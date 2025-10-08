/**
 * React Query client configuration with proper defaults
 * Fixes issues from original configuration (disabled refetching, no retries)
 */

import { QueryClient } from '@tanstack/react-query'

/**
 * Stale time configurations for different data categories
 */
export const STALE_TIMES = {
  // Real-time data - always refetch
  REAL_TIME: 0,

  // Fast-changing data (fees, prices)
  VOLATILE: 15 * 1000, // 15 seconds

  // Medium-changing data (pool stats, user positions)
  NORMAL: 30 * 1000, // 30 seconds

  // Slow-changing data (historical charts, token metadata)
  STABLE: 5 * 60 * 1000, // 5 minutes

  // Static data (pool addresses, token lists)
  STATIC: 60 * 60 * 1000, // 1 hour
} as const

/**
 * Garbage collection times
 */
export const GC_TIMES = {
  SHORT: 5 * 60 * 1000, // 5 minutes
  MEDIUM: 30 * 60 * 1000, // 30 minutes
  LONG: 24 * 60 * 60 * 1000, // 24 hours
} as const

/**
 * Create a properly configured QueryClient
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Default stale time - queries should override this
        staleTime: STALE_TIMES.NORMAL,

        // Keep data in cache for 30 minutes after last use
        gcTime: GC_TIMES.MEDIUM,

        // Refetch on window focus to get fresh data when user returns
        refetchOnWindowFocus: true,

        // Don't refetch on mount if data is fresh
        refetchOnMount: false,

        // Refetch after network reconnection
        refetchOnReconnect: true,

        // Retry once on failure (handles transient network issues)
        retry: 1,

        // Don't retry on client errors (4xx)
        retryOnMount: false,

        // Network mode
        networkMode: 'online',
      },
      mutations: {
        // Don't retry mutations by default (user actions should be explicit)
        retry: 0,

        // Network mode
        networkMode: 'online',
      },
    },
  })
}

/**
 * Singleton instance for the application
 */
export const queryClient = createQueryClient()
