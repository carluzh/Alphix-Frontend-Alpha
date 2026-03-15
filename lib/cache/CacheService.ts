/**
 * Centralized Caching Service
 *
 * This is a thin wrapper around proven redis.ts functions that provides:
 * - Clean, consistent API for all caching operations
 * - Request deduplication (prevents duplicate in-flight API calls)
 * - User-specific cache keying (prevents data leakage between users)
 * - TypeScript-first design
 *
 * This does NOT rebuild the caching system - it wraps existing proven code.
 */

import { getCachedDataWithStale, setCachedData, invalidateCachedData } from '@/lib/cache/redis'
import type { TTLConfig, CacheOptions, CacheResult, CacheApiResult } from './types'

/**
 * Default cache guard - prevents caching common failure patterns.
 * Checks for:
 * - Objects with `success: false`
 * - Objects with `error` property
 * - Objects with only `message` property (error responses)
 *
 * This runs BEFORE any custom shouldCache, acting as a safety net.
 */
function isValidCachePayload(data: unknown): boolean {
  if (data === null || data === undefined) return false

  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>

    // Explicit failure flag
    if (obj.success === false) return false

    // Has error property
    if ('error' in obj && obj.error) return false

    // Looks like an error response (has message but no data/success)
    if ('message' in obj && !('data' in obj) && !('success' in obj)) return false
  }

  return true
}

export class CacheService {
  // NOTE: In-memory request deduplication removed for serverless compatibility
  // Redis handles concurrent request coordination via atomic operations

  /**
   * Get cached data with stale-while-revalidate support
   * Wraps getCachedDataWithStale() from redis.ts
   */
  async getWithStale<T>(
    key: string,
    ttl: TTLConfig,
    fetchFn?: () => Promise<T>
  ): Promise<CacheResult<T>> {
    // Delegate to existing implementation
    const result = await getCachedDataWithStale<T>(key, ttl.fresh, ttl.stale)

    // If fetch function provided and cache miss, fetch and cache
    if (!result.data && fetchFn) {
      const freshData = await fetchFn()
      // Only cache valid payloads
      if (isValidCachePayload(freshData)) {
        await this.set(key, freshData, ttl.stale)
      }
      return { data: freshData, isStale: false, isInvalidated: false }
    }

    return result
  }

  /**
   * Set cached data with TTL
   * Wraps setCachedData() from redis.ts
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    return setCachedData(key, value, ttlSeconds)
  }

  /**
   * Invalidate cached data (marks as stale without deleting)
   * Wraps invalidateCachedData() from redis.ts
   */
  async invalidate(key: string): Promise<void> {
    return invalidateCachedData(key)
  }

  /**
   * Higher-level helper: Cached API call with stale-while-revalidate
   * This is the pattern all endpoints should use
   */
  async cachedApiCall<T>(
    key: string,
    ttl: TTLConfig,
    fetchFn: () => Promise<T>,
    options?: CacheOptions
  ): Promise<CacheApiResult<T>> {
    // Skip cache if requested
    if (options?.skipCache) {
      const data = await fetchFn()
      return { data, isStale: false }
    }

    // Check cache first (now includes noCacheUntil for cooldown protection)
    const result = await getCachedDataWithStale<T>(key, ttl.fresh, ttl.stale)
    const { data: cachedData, isStale, isInvalidated, noCacheUntil } = result

    // Fresh cache hit - return immediately
    if (cachedData && !isStale && !isInvalidated) {
      return { data: cachedData, isStale: false }
    }

    if (cachedData && isInvalidated) {
      const freshData = await fetchFn()
      const isInCooldown = noCacheUntil && Date.now() < noCacheUntil
      if (!isInCooldown) {
        // Default guard + custom guard
        const passesDefaultGuard = isValidCachePayload(freshData)
        const passesCustomGuard = !options?.shouldCache || options.shouldCache(freshData)
        if (passesDefaultGuard && passesCustomGuard) {
          await this.set(key, freshData, ttl.stale)
        }
      }
      return { data: freshData, isStale: false }
    }

    if (cachedData && isStale) {
      // Background refresh - stale-while-revalidate pattern
      fetchFn()
        .then(freshData => {
          // Default guard + custom guard
          const passesDefaultGuard = isValidCachePayload(freshData)
          const passesCustomGuard = !options?.shouldCache || options.shouldCache(freshData)
          if (passesDefaultGuard && passesCustomGuard) {
            return this.set(key, freshData, ttl.stale)
          }
        })
        .catch(err => console.error('[CacheService] Background refresh failed:', err))

      return { data: cachedData, isStale: true }
    }

    // No cached data - fetch fresh
    const freshData = await fetchFn()
    // Default guard + custom guard
    const passesDefaultGuard = isValidCachePayload(freshData)
    const passesCustomGuard = !options?.shouldCache || options.shouldCache(freshData)
    if (passesDefaultGuard && passesCustomGuard) {
      await this.set(key, freshData, ttl.stale)
    }
    return { data: freshData, isStale: false }
  }

}

export const cacheService = new CacheService()
