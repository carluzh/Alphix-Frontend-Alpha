const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const appCache: Record<string, CacheEntry<any>> = {};

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

export function setToCache<T>(key: string, data: T): void {
  // console.log(`[Cache SET] for key: ${key}`);
  appCache[key] = { data, timestamp: Date.now() };
}

export function clearCache(): void {
  // console.log('[Cache CLEARED]');
  for (const key in appCache) {
    delete appCache[key];
  }
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
  `dynamicFee_${fromTokenSymbol}_${toTokenSymbol}_${chainId}`; 