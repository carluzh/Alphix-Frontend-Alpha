import { Redis } from '@upstash/redis';

// Create Redis client - only initialize if env vars are present
let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// Cache wrapper with metadata
export interface CachedDataWrapper<T> {
  data: T;
  meta: {
    timestamp: number;
    invalidated: boolean;
  };
}

export async function getCachedData<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const data = await redis.get<T>(key);
    return data;
  } catch (error) {
    console.error('[Redis] Get failed:', error);
    return null;
  }
}

export async function setCachedData<T>(key: string, data: T, ttlSeconds: number = 300): Promise<void> {
  if (!redis) return;

  try {
    const wrapper: CachedDataWrapper<T> = {
      data,
      meta: {
        timestamp: Date.now(),
        invalidated: false,
      },
    };
    // Upstash handles JSON serialization automatically - don't double-stringify
    await redis.setex(key, ttlSeconds, wrapper);
  } catch (error) {
    console.error('[Redis] Set failed:', error);
  }
}

// Stale-while-revalidate: Get cached data with staleness check and invalidation status
export async function getCachedDataWithStale<T>(
  key: string,
  freshTTL: number = 300, // 5 minutes fresh
  staleTTL: number = 900  // 15 minutes total (10 min stale window)
): Promise<{ data: T | null; isStale: boolean; isInvalidated: boolean }> {
  if (!redis) return { data: null, isStale: false, isInvalidated: false };

  try {
    const wrapper = await redis.get<CachedDataWrapper<T>>(key);

    if (!wrapper || !wrapper.meta) {
      return { data: null, isStale: false, isInvalidated: false };
    }

    const { data, meta } = wrapper;
    const age = Date.now() - meta.timestamp;
    const freshThreshold = freshTTL * 1000; // Convert to ms
    const staleThreshold = staleTTL * 1000; // Convert to ms

    // If explicitly invalidated, treat as cache miss (will trigger blocking refresh)
    if (meta.invalidated) {
      return { data, isStale: true, isInvalidated: true };
    }

    // Data is fresh if younger than freshTTL
    if (age < freshThreshold) {
      return { data, isStale: false, isInvalidated: false };
    }

    // Data is stale if older than freshTTL but younger than staleTTL
    if (age < staleThreshold) {
      return { data, isStale: true, isInvalidated: false };
    }

    // Data is too old, treat as missing
    return { data: null, isStale: false, isInvalidated: false };
  } catch (error) {
    console.error('[Redis] Get with stale failed:', error);
    return { data: null, isStale: false, isInvalidated: false };
  }
}

export async function deleteCachedData(key: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error) {
    console.error('[Redis] Delete failed:', error);
  }
}

// Mark cache as invalidated without deleting (data remains but will trigger blocking refresh)
export async function invalidateCachedData(key: string): Promise<void> {
  if (!redis) return;

  try {
    const wrapper = await redis.get<CachedDataWrapper<any>>(key);

    if (wrapper && wrapper.meta) {
      wrapper.meta.invalidated = true;
      // Keep the same TTL by re-setting with the original data
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.setex(key, ttl, wrapper);
        console.log(`[Redis] Cache invalidated: ${key}`);
      }
    }
  } catch (error) {
    console.error('[Redis] Invalidation failed:', error);
  }
}

// Export redis instance for advanced usage
export { redis };
