// Global cache version management - stable until mutations
let globalVersion = Date.now();
const VERSION_TTL = 60 * 60 * 1000; // 1 hour TTL
let lastVersionUpdate = Date.now();

// Client-side batch data cache
interface CachedBatchData {
  data: any;
  timestamp: number;
  version: number;
}

let batchDataCache: CachedBatchData | null = null;
const BATCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for client cache

export function getGlobalVersion(): number {
  // No automatic bump here; version changes on explicit bump or via cache-version route TTL check
  return globalVersion;
}

export function bumpGlobalVersion(): number {
  globalVersion = Date.now();
  lastVersionUpdate = Date.now();
  // Clear client cache when version changes
  batchDataCache = null;
  return globalVersion;
}

export function getCacheKeyWithVersion(baseKey: string): string[] {
  const version = getGlobalVersion();
  return [`${baseKey}-v${version}`];
}

// Client-side batch data caching
export function getCachedBatchData(): any | null {
  if (!batchDataCache) return null;

  const now = Date.now();
  const age = now - batchDataCache.timestamp;

  // Check if cache is expired or version changed
  if (age > BATCH_CACHE_TTL || batchDataCache.version !== getGlobalVersion()) {
    batchDataCache = null;
    return null;
  }

  return batchDataCache.data;
}

export function setCachedBatchData(data: any): void {
  batchDataCache = {
    data,
    timestamp: Date.now(),
    version: getGlobalVersion()
  };
}

export function clearBatchDataCache(): void {
  batchDataCache = null;
}

// For debugging
export function debugVersion(): { version: number, ttl: number, expiresAt: number, age: number, hasCache: boolean, cacheAge: number | undefined } {
  const now = Date.now();
  const result = {
    version: globalVersion,
    ttl: VERSION_TTL,
    expiresAt: lastVersionUpdate + VERSION_TTL,
    age: now - lastVersionUpdate,
    hasCache: batchDataCache !== null,
    cacheAge: batchDataCache ? now - batchDataCache.timestamp : undefined
  };

  return result;
}
