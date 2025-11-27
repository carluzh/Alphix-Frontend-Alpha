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

import { redis, getCachedDataWithStale, setCachedData, deleteCachedData, invalidateCachedData, CachedDataWrapper } from '@/lib/redis'
import type { TTLConfig, CacheOptions, CacheResult, CacheApiResult } from './types'

export class CacheService {
  // Request deduplication: Track ongoing requests to prevent duplicates
  private ongoingRequests = new Map<string, Promise<any>>()

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
      await this.set(key, freshData, ttl.stale)
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
   * Get cached data (simple get, no staleness check)
   * Wraps existing Redis client
   */
  async get<T>(key: string): Promise<T | null> {
    if (!redis) return null

    try {
      const wrapper = await redis.get<CachedDataWrapper<T>>(key)
      return wrapper?.data || null
    } catch (error) {
      console.error('[CacheService] Get failed:', error)
      return null
    }
  }

  /**
   * Delete cached data
   * Wraps deleteCachedData() from redis.ts
   */
  async delete(key: string): Promise<void> {
    return deleteCachedData(key)
  }

  /**
   * Invalidate cached data (marks as stale without deleting)
   * Wraps invalidateCachedData() from redis.ts
   */
  async invalidate(key: string): Promise<void> {
    return invalidateCachedData(key)
  }

  /**
   * Batch invalidate multiple keys
   */
  async invalidateMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map(key => this.invalidate(key)))
  }

  /**
   * Higher-level helper: Cached API call with stale-while-revalidate
   * This is the pattern all endpoints should use
   *
   * INCLUDES REQUEST DEDUPLICATION - prevents duplicate in-flight API calls
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

    // REQUEST DEDUPLICATION: Check for ongoing request
    const ongoing = this.ongoingRequests.get(key)
    if (ongoing) {
      console.log('[CacheService] Deduplicating request:', key)
      return ongoing
    }

    // Create promise for this request
    const promise = (async () => {
      try {
        // Check cache first
        const { data: cachedData, isStale, isInvalidated } = await this.getWithStale<T>(
          key,
          ttl
        )

        // Fresh cache hit - return immediately
        if (cachedData && !isStale && !isInvalidated) {
          return { data: cachedData, isStale: false }
        }

        // Invalidated cache - blocking fetch
        if (cachedData && isInvalidated) {
          const freshData = await fetchFn()
          await this.set(key, freshData, ttl.stale)
          return { data: freshData, isStale: false }
        }

        // Stale cache - return stale, refresh in background
        if (cachedData && isStale) {
          // Fire and forget background refresh
          fetchFn()
            .then(freshData => this.set(key, freshData, ttl.stale))
            .catch(err => console.error('[CacheService] Background refresh failed:', err))

          return { data: cachedData, isStale: true }
        }

        // Cache miss - fetch and cache
        const freshData = await fetchFn()
        await this.set(key, freshData, ttl.stale)
        return { data: freshData, isStale: false }
      } finally {
        // Clean up ongoing request
        this.ongoingRequests.delete(key)
      }
    })()

    // Track this request for deduplication
    this.ongoingRequests.set(key, promise)
    return promise
  }

  /**
   * WEB3-SPECIFIC: Cached user data with enforced per-user keying
   * Prevents accidentally returning user A's data to user B
   *
   * Example:
   *   const positions = await cacheService.cachedUserData(
   *     userAddress,
   *     'positions',
   *     { fresh: 120, stale: 600 },
   *     () => fetchUserPositions(userAddress)
   *   )
   */
  async cachedUserData<T>(
    userId: string,
    dataType: string,
    ttl: TTLConfig,
    fetchFn: () => Promise<T>
  ): Promise<CacheApiResult<T>> {
    // Enforce lowercase and proper keying format
    const userKey = `${dataType}:${userId.toLowerCase()}`
    return this.cachedApiCall(userKey, ttl, fetchFn)
  }
}

// Singleton instance for use across the app
export const cacheService = new CacheService()
