// Global cache version management - stable until mutations
let globalVersion = Date.now();
const VERSION_TTL = 10 * 60 * 1000; // 10 minutes - data considered fresh for this long
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
  const now = Date.now();
  // Auto-refresh version if TTL expired
  if (now - lastVersionUpdate > VERSION_TTL) {
    globalVersion = now;
    lastVersionUpdate = now;
    console.log(`[Version] Auto-refreshed to: ${globalVersion}`);
    // Clear client cache when version changes
    batchDataCache = null;
  }
  return globalVersion;
}

export function bumpGlobalVersion(): number {
  globalVersion = Date.now();
  lastVersionUpdate = Date.now();
  console.log(`[Version] Bumped to: ${globalVersion}`);
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
    console.log(`[BatchCache] Cache expired (age: ${Math.round(age/1000)}s)`);
    batchDataCache = null;
    return null;
  }

  console.log(`[BatchCache] Hit (age: ${Math.round(age/1000)}s)`);
  return batchDataCache.data;
}

export function setCachedBatchData(data: any): void {
  batchDataCache = {
    data,
    timestamp: Date.now(),
    version: getGlobalVersion()
  };
  console.log(`[BatchCache] Set`);
}

export function clearBatchDataCache(): void {
  batchDataCache = null;
  console.log(`[BatchCache] Cleared`);
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
