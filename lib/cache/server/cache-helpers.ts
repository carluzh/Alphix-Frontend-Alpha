/**
 * Server-side cache helpers for Next.js
 * Utilities for working with unstable_cache and tag-based invalidation
 */

import { unstable_cache } from 'next/cache'

/**
 * Server cache tags for invalidation
 */
export const CACHE_TAGS = {
  POOLS_BATCH: 'pools-batch',
  POOL_STATS: 'pool-stats',
  USER_POSITIONS: 'user-positions',
} as const

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS]

/**
 * Default cache configuration
 */
export const CACHE_CONFIG = {
  DEFAULT_REVALIDATE: 3600, // 1 hour
  BATCH_REVALIDATE: 3600, // 1 hour
  STATS_REVALIDATE: 1800, // 30 minutes
} as const

/**
 * Create a versioned cache key
 * Version should be a timestamp or incrementing number
 */
export function createVersionedKey(baseKey: string, version?: string | number): string {
  return version ? `${baseKey}-v${version}` : baseKey
}

/**
 * Wrapper for unstable_cache with type safety and consistent configuration
 */
export function createServerCache<T, Args extends any[]>(
  fn: (...args: Args) => Promise<T>,
  options: {
    keyPrefix: string
    tags: CacheTag[]
    revalidate?: number
  }
) {
  return async (...args: Args): Promise<T> => {
    const cached = unstable_cache(
      fn,
      [options.keyPrefix, ...args.map((arg) => String(arg))],
      {
        tags: options.tags,
        revalidate: options.revalidate ?? CACHE_CONFIG.DEFAULT_REVALIDATE,
      }
    )

    return await cached(...args)
  }
}

/**
 * Validate if cached data looks reasonable (not stale/corrupted)
 */
export function validatePoolsData(pools: any[]): boolean {
  if (!pools || !Array.isArray(pools) || pools.length === 0) {
    return false
  }

  // Check if we have real data (not all zeros)
  const hasValidTVL = pools.some((pool) => pool.tvlUSD && pool.tvlUSD > 0)
  const hasValidVolume = pools.some((pool) => pool.volume24hUSD && pool.volume24hUSD > 0)

  return hasValidTVL && hasValidVolume
}

/**
 * Check if subgraph data is fresh enough
 */
export function isSubgraphDataFresh(
  blockTimestamp: number,
  maxAgeSeconds = 300
): boolean {
  const now = Math.floor(Date.now() / 1000)
  const age = now - blockTimestamp
  return age < maxAgeSeconds
}
