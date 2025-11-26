import { Redis } from '@upstash/redis'

// Initialize Redis client (null if env vars missing)
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null

interface CacheEntry<T> {
  data: T
  timestamp: number
}

interface WithCacheOptions<T> {
  freshTTL?: number      // Seconds before data is considered stale (default: 300)
  maxTTL?: number        // Seconds before data is evicted entirely (default: 900)
  validate?: (data: T) => boolean  // Return false to reject and refetch
}

/**
 * Cache wrapper with stale-while-revalidate pattern
 *
 * - HIT (fresh): Return cached data immediately
 * - HIT (stale): Return cached data + trigger background refresh
 * - MISS: Fetch from source, cache, return
 *
 * Falls back to direct fetch if Redis unavailable
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: WithCacheOptions<T> = {}
): Promise<T> {
  const { freshTTL = 300, maxTTL = 900, validate } = options

  // No Redis = direct fetch
  if (!redis) {
    return fetcher()
  }

  try {
    // Check cache
    const cached = await redis.get<CacheEntry<T>>(key)

    if (cached?.data !== undefined && cached?.timestamp) {
      const ageSeconds = (Date.now() - cached.timestamp) / 1000

      // Fresh hit - return immediately
      if (ageSeconds < freshTTL) {
        return cached.data
      }

      // Stale hit - return stale data, refresh in background
      if (ageSeconds < maxTTL) {
        refreshInBackground(key, fetcher, maxTTL, validate)
        return cached.data
      }
    }

    // Cache miss - fetch and cache
    return await fetchAndCache(key, fetcher, maxTTL, validate)
  } catch (error) {
    console.error(`[Redis] Cache error for ${key}:`, error)
    // Fallback to direct fetch on any Redis error
    return fetcher()
  }
}

async function fetchAndCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  validate?: (data: T) => boolean
): Promise<T> {
  const data = await fetcher()

  // Validate before caching
  if (validate && !validate(data)) {
    throw new Error(`Validation failed for cache key: ${key}`)
  }

  // Cache the result
  if (redis) {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() }
    await redis.setex(key, ttl, entry).catch(err => {
      console.error(`[Redis] Failed to cache ${key}:`, err)
    })
  }

  return data
}

function refreshInBackground<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number,
  validate?: (data: T) => boolean
): void {
  // Fire and forget - don't await
  fetchAndCache(key, fetcher, ttl, validate).catch(err => {
    console.error(`[Redis] Background refresh failed for ${key}:`, err)
  })
}

/**
 * Manually invalidate a cache key
 */
export async function invalidateCache(key: string): Promise<void> {
  if (!redis) return
  await redis.del(key).catch(err => {
    console.error(`[Redis] Failed to invalidate ${key}:`, err)
  })
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return redis !== null
}

export { redis }
