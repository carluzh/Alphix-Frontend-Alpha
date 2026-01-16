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
    noCacheUntil?: number;
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
): Promise<{ data: T | null; isStale: boolean; isInvalidated: boolean; noCacheUntil?: number }> {
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

    if (meta.invalidated) {
      return { data, isStale: true, isInvalidated: true, noCacheUntil: meta.noCacheUntil };
    }

    if (age < freshThreshold) {
      return { data, isStale: false, isInvalidated: false };
    }

    if (age < staleThreshold) {
      return { data, isStale: true, isInvalidated: false };
    }

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

const INVALIDATION_COOLDOWN_MS = 15000;

export async function invalidateCachedData(key: string, cooldownMs: number = INVALIDATION_COOLDOWN_MS): Promise<void> {
  if (!redis) {
    console.error(`[Redis] ❌ Cannot invalidate ${key} - Redis not initialized`);
    return;
  }

  try {
    const wrapper = await redis.get<CachedDataWrapper<any>>(key);

    if (!wrapper || !wrapper.meta) {
      console.warn(`[Redis] ⚠️ Key not found or invalid: ${key}`);
      return;
    }

    const ttl = await redis.ttl(key);

    if (ttl <= 0) {
      console.warn(`[Redis] ⚠️ Key expired (TTL=${ttl}): ${key}`);
      return;
    }

    wrapper.meta.invalidated = true;
    wrapper.meta.timestamp = Date.now();
    wrapper.meta.noCacheUntil = Date.now() + cooldownMs;

    const safeTTL = Math.max(ttl, 5);

    await redis.setex(key, safeTTL, wrapper);

    console.log(`[Redis] ✅ Cache invalidated: ${key} (TTL: ${safeTTL}s, cooldown: ${cooldownMs}ms)`);
  } catch (error) {
    console.error(`[Redis] ❌ Invalidation failed for ${key}:`, error);
  }
}

// Export redis instance for advanced usage
export { redis };
