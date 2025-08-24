const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const LONG_CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes for stable data
const TEN_MINUTES_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const appCache: Record<string, CacheEntry<any>> = {};

// Request deduplication: track ongoing requests to prevent duplicates
const ongoingRequests = new Map<string, Promise<any>>();

export function getFromCache<T>(key: string): T | null {
  const entry = appCache[key];
  if (entry && (Date.now() - entry.timestamp < CACHE_DURATION_MS)) {
    // console.log(`[Cache HIT] for key: ${key}`);
    return entry.data as T;
  }
  if (entry) {
    // console.log(`[Cache STALE] for key: ${key}. Entry expired.`);
    delete appCache[key]; // Remove stale entry
  } else {
    // console.log(`[Cache MISS] for key: ${key}`);
  }
  return null;
}

export function getFromLongCache<T>(key: string): T | null {
  const entry = appCache[key];
  if (entry && (Date.now() - entry.timestamp < LONG_CACHE_DURATION_MS)) {
    return entry.data as T;
  }
  if (entry) {
    delete appCache[key]; // Remove stale entry
  }
  return null;
}

// Generic TTL-based cache getter without changing global defaults
export function getFromCacheWithTtl<T>(key: string, ttlMs: number = TEN_MINUTES_MS): T | null {
  const entry = appCache[key];
  if (entry && (Date.now() - entry.timestamp < ttlMs)) {
    return entry.data as T;
  }
  if (entry) {
    delete appCache[key];
  }
  return null;
}

export function setToCache<T>(key: string, data: T): void {
  // console.log(`[Cache SET] for key: ${key}`);
  appCache[key] = { data, timestamp: Date.now() };
}

export function setToLongCache<T>(key: string, data: T): void {
  // console.log(`[Long Cache SET] for key: ${key}`);
  appCache[key] = { data, timestamp: Date.now() };
}

// Request deduplication helpers
export function getOngoingRequest<T>(key: string): Promise<T> | null {
  return ongoingRequests.get(key) || null;
}

export function setOngoingRequest<T>(key: string, promise: Promise<T>): Promise<T> {
  ongoingRequests.set(key, promise);
  promise.finally(() => {
    ongoingRequests.delete(key);
  });
  return promise;
}

export function clearCache(): void {
  // console.log('[Cache CLEARED]');
  for (const key in appCache) {
    delete appCache[key];
  }
  ongoingRequests.clear();
}

export function invalidateCacheEntry(key: string): void {
  // console.log(`[Cache INVALIDATED] for key: ${key}`);
  delete appCache[key];
}

// Function to generate a cache key for all user positions for a specific owner
export const getUserPositionsCacheKey = (ownerAddress: string) => `userPositions_${ownerAddress}`;

// Function to generate a cache key for a specific pool's detailed stats
export const getPoolStatsCacheKey = (poolApiId: string) => `poolStats_${poolApiId}`;

// Function to generate a cache key for a pool's dynamic fee
export const getPoolDynamicFeeCacheKey = (fromTokenSymbol: string, toTokenSymbol: string, chainId: number) =>
  `poolDynamicFee_${fromTokenSymbol}_${toTokenSymbol}_${chainId}`;

// Batch data loading cache keys
export const getPoolBatchDataCacheKey = (poolIds: string[]) => `poolBatch_${poolIds.sort().join('_')}`;

// Chart data cache key per pool detail page
export const getPoolChartDataCacheKey = (poolId: string) => `poolChart_${poolId}`;

// Background refresh for frequently accessed data
export function refreshCacheInBackground<T>(key: string, refreshFn: () => Promise<T>): void {
  // Only refresh if data will expire soon (within 2 minutes)
  const entry = appCache[key];
  if (entry && (Date.now() - entry.timestamp > 3 * 60 * 1000)) {
    refreshFn().then(data => setToCache(key, data)).catch(console.warn);
  }
} 