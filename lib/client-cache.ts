/**
 * Client-Side Cache Utilities
 *
 * Provides client-side caching and coordination:
 * - Request deduplication (prevents duplicate in-flight requests)
 * - Indexing barriers (coordinates fetches until subgraph syncs)
 * - User position IDs (localStorage-based, 24h TTL)
 * - Subgraph sync waiter
 */

import { SafeStorage } from './safe-storage';
import { RetryUtility } from './retry-utility';
import { getStoredNetworkMode } from './network-mode';

// Get network prefix for cache keys to prevent data contamination between networks
function getNetworkPrefix(): string {
  const networkMode = getStoredNetworkMode();
  return networkMode === 'mainnet' ? 'mainnet' : 'testnet';
}

// Request deduplication: track ongoing requests to prevent duplicates
const ongoingRequests = new Map<string, Promise<any>>();

// Indexing barriers: gate fresh fetches until subgraph head reaches tx block
const indexingBarriers = new Map<string, Promise<boolean>>();

/**
 * Set an indexing barrier for a user
 * Used after transactions to prevent stale data from being cached before subgraph sync
 */
export function setIndexingBarrier(ownerAddress: string, barrier: Promise<boolean>): void {
  const key = (ownerAddress || '').toLowerCase();
  indexingBarriers.set(key, barrier);

  // IMPORTANT: If a fresh barrier is set, purge any ongoing position IDs request
  // This prevents pre-barrier promises from completing and poisoning the cache
  try {
    const idsKey = `userPositionIds_${key}`;
    ongoingRequests.delete(idsKey);
  } catch {}

  barrier.finally(() => {
    // Auto-cleanup when barrier resolves
    if (indexingBarriers.get(key) === barrier) {
      indexingBarriers.delete(key);
    }
  });
}

/**
 * Get the current indexing barrier for a user (if any)
 */
export function getIndexingBarrier(ownerAddress: string): Promise<boolean> | null {
  const key = (ownerAddress || '').toLowerCase();
  return indexingBarriers.get(key) || null;
}

/**
 * Get an ongoing request to prevent duplicate fetches
 */
export function getOngoingRequest<T>(key: string): Promise<T> | null {
  return ongoingRequests.get(key) || null;
}

/**
 * Register an ongoing request for deduplication
 */
export function setOngoingRequest<T>(key: string, promise: Promise<T>): Promise<T> {
  ongoingRequests.set(key, promise);
  promise.finally(() => {
    if (ongoingRequests.get(key) === promise) {
      ongoingRequests.delete(key);
    }
  });
  return promise;
}

/**
 * Cache key for user position IDs in localStorage
 * Includes network prefix to prevent data contamination between networks
 */
function getUserPositionIdsCacheKey(address: string): string {
  const prefix = getNetworkPrefix();
  return `${prefix}:userPositionIds_${address.toLowerCase()}`;
}

/** Invalidate user position IDs cache in localStorage */
export function invalidateUserPositionIdsCache(ownerAddress: string): void {
  try { SafeStorage.remove(getUserPositionIdsCacheKey(ownerAddress)); } catch {}
}

/**
 * Add a position ID directly to the cache (from transaction receipt)
 * This bypasses subgraph and ensures the position is immediately visible
 *
 * @param ownerAddress - User wallet address
 * @param tokenId - Position NFT token ID from Transfer event
 * @param createdAt - Optional timestamp (defaults to now)
 */
export function addPositionIdToCache(ownerAddress: string, tokenId: string, createdAt?: number): void {
  if (!ownerAddress || !tokenId) return;

  const key = getUserPositionIdsCacheKey(ownerAddress);
  const now = Date.now();
  const timestamp = createdAt || Math.floor(now / 1000);

  try {
    const raw = SafeStorage.get(key);
    let items: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];
    let cacheTimestamp = now;

    if (raw) {
      const parsed = JSON.parse(raw);
      items = parsed.items || [];
      cacheTimestamp = parsed.timestamp || now;
    }

    // Check if tokenId already exists
    const exists = items.some(it => it.id === tokenId);
    if (!exists) {
      items.unshift({ id: tokenId, createdAt: timestamp, lastTimestamp: timestamp });
      SafeStorage.set(key, JSON.stringify({ items, timestamp: cacheTimestamp }));
      console.log(`[Cache] Added position ${tokenId} directly to cache for ${ownerAddress}`);
    }
  } catch (error) {
    console.warn('[Cache] Failed to add position ID to cache:', error);
  }
}

/** Get cached timestamps map for position APY calculation */
export function getCachedPositionTimestamps(ownerAddress: string): Map<string, { createdAt: number; lastTimestamp: number }> {
  const map = new Map<string, { createdAt: number; lastTimestamp: number }>();
  if (!ownerAddress) return map;
  try {
    const raw = SafeStorage.get(getUserPositionIdsCacheKey(ownerAddress));
    if (raw) {
      const { items } = JSON.parse(raw) as { items?: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> };
      items?.forEach(it => it.id && map.set(it.id, { createdAt: it.createdAt || 0, lastTimestamp: it.lastTimestamp || 0 }));
    }
  } catch {}
  return map;
}

/**
 * Options for loadUserPositionIds
 */
export interface LoadPositionIdsOptions {
  /** Callback when background refresh completes with fresh data */
  onRefreshed?: (ids: string[]) => void;
  /** Skip background refresh (for internal use during barriers) */
  skipBackgroundRefresh?: boolean;
}

/**
 * Load user position IDs with stale-while-revalidate pattern
 *
 * Returns cached data immediately (if available) and always refreshes in background.
 * When fresh data arrives, the cache is updated and onRefreshed callback is called.
 *
 * @param ownerAddress - User wallet address
 * @param options - Optional configuration
 * @returns Array of position token IDs (from cache if available, otherwise waits for fetch)
 */
export async function loadUserPositionIds(
  ownerAddress: string,
  options?: LoadPositionIdsOptions
): Promise<string[]> {
  if (!ownerAddress) return [];

  const key = getUserPositionIdsCacheKey(ownerAddress);

  // Check localStorage cache
  let cachedIds: string[] = [];
  try {
    const raw = SafeStorage.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      if (Array.isArray(parsed?.items)) {
        cachedIds = parsed.items.map((it: any) => String(it?.id || '')).filter(Boolean);
      }
    }
  } catch {}

  // Check for indexing barrier - if present, return cached and wait for barrier before refresh
  const barrier = getIndexingBarrier(ownerAddress);
  if (barrier) {
    barrier.then(async (ok) => {
      if (ok && options?.onRefreshed) {
        const freshIds = await fetchAndCachePositionIds(ownerAddress, key);
        if (freshIds) options.onRefreshed(freshIds);
      }
    }).catch(() => {});
    return cachedIds;
  }

  // SWR: If we have cached data, return it and refresh in background
  if (cachedIds.length > 0) {
    if (options?.onRefreshed) {
      refreshPositionIdsInBackground(ownerAddress, key, cachedIds, options.onRefreshed);
    }
    return cachedIds;
  }

  // No cached data - must wait for fetch
  const freshIds = await fetchAndCachePositionIds(ownerAddress, key);
  return freshIds || [];
}

/**
 * Refresh position IDs in background (stale-while-revalidate)
 */
function refreshPositionIdsInBackground(
  ownerAddress: string,
  cacheKey: string,
  currentIds: string[],
  onRefreshed?: (ids: string[]) => void
): void {
  // Check for ongoing request to prevent duplicate fetches
  const ongoing = getOngoingRequest<string[]>(cacheKey);
  if (ongoing) {
    // Attach to existing request
    ongoing.then((ids) => {
      if (onRefreshed && !arraysEqual(ids, currentIds)) {
        onRefreshed(ids);
      }
    }).catch(() => {});
    return;
  }

  // Start background fetch
  const promise = fetchAndCachePositionIds(ownerAddress, cacheKey).then((freshIds) => {
    if (freshIds && onRefreshed && !arraysEqual(freshIds, currentIds)) {
      console.log('[Cache] Background refresh found new position data');
      onRefreshed(freshIds);
    }
    return freshIds || [];
  });

  setOngoingRequest(cacheKey, promise);
}

/**
 * Fetch position IDs from API and cache them
 */
async function fetchAndCachePositionIds(
  ownerAddress: string,
  cacheKey: string
): Promise<string[] | null> {
  const result = await RetryUtility.execute(
    async () => {
      const res = await fetch(
        `/api/liquidity/get-positions?ownerAddress=${ownerAddress}&idsOnly=1&withCreatedAt=1`,
        { cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const ids: string[] = [];
      const itemsPersist: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];

      if (Array.isArray(data)) {
        for (const item of data) {
          try {
            if (!item) continue;
            let idStr = '';
            if (typeof item.id === 'string') {
              idStr = item.id;
            } else if (typeof item.id === 'number' || typeof item.id === 'bigint') {
              idStr = item.id.toString();
            } else if (item.id && typeof item.id === 'object' && 'toString' in item.id) {
              idStr = item.id.toString();
            } else {
              idStr = String((item as any).id || '');
            }

            if (idStr && idStr !== '0' && idStr !== 'undefined' && idStr !== 'null') {
              ids.push(idStr);
              itemsPersist.push({
                id: idStr,
                createdAt: Number((item as any)?.createdAt || 0),
                lastTimestamp: Number((item as any)?.lastTimestamp || 0)
              });
            }
          } catch (error) {
            console.warn('[Cache] Failed to process position item:', item, error);
          }
        }
      }

      return { ids, itemsPersist };
    },
    {
      attempts: 1,
      backoffStrategy: 'fixed',
      baseDelay: 500,
      throwOnFailure: false
    }
  );

  if (!result.success || !result.data) {
    return null;
  }

  const { ids, itemsPersist } = result.data;

  // Don't cache if there's an active barrier (data might be stale)
  const barrierFinal = getIndexingBarrier(ownerAddress);
  if (barrierFinal) {
    return ids;
  }

  // Cache to localStorage
  try {
    SafeStorage.set(cacheKey, JSON.stringify({
      items: itemsPersist,
      timestamp: Date.now()
    }));
  } catch {}

  return ids;
}

/**
 * Helper to compare two string arrays
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

/**
 * Wait for subgraph to index a specific block number
 *
 * Used after transactions to ensure subgraph has processed the tx before fetching data.
 * Polls /api/liquidity/subgraph-head endpoint until block number is reached.
 *
 * @param targetBlock - Block number to wait for
 * @param opts - Configuration options
 * @returns true if subgraph reached target block, false if timeout
 */
export async function waitForSubgraphBlock(
  targetBlock: number,
  opts?: { timeoutMs?: number; minWaitMs?: number; maxIntervalMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const minWaitMs = opts?.minWaitMs ?? 800;
  const maxIntervalMs = opts?.maxIntervalMs ?? 1200;

  const start = Date.now();
  let interval = 250;
  const jitter = () => Math.floor(Math.random() * 80);

  try {
    // Small initial wait to smooth indexing jitter
    await new Promise((r) => setTimeout(r, minWaitMs));

    for (;;) {
      if (Date.now() - start > timeoutMs) return false;

      const resp = await fetch('/api/liquidity/subgraph-head', { cache: 'no-store' });
      if (resp.ok) {
        const { subgraphHead } = await resp.json();
        if (typeof subgraphHead === 'number' && subgraphHead >= targetBlock) return true;
      }

      await new Promise((r) => setTimeout(r, Math.min(maxIntervalMs, interval) + jitter()));
      interval = Math.min(maxIntervalMs, Math.floor(interval * 1.6));
    }
  } catch {
    return false;
  }
}

/**
 * Clear deprecated cache entries from localStorage
 * Called on app mount to clean up old caching system before Redis migration
 *
 * Removes all old client-side cache keys that have been migrated to Redis.
 */
export function clearDeprecatedCaches(): void {
  try {
    const keysToRemove: string[] = [];

    // Find all deprecated cache keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Remove old alphix:cache:* keys (pre-Redis system)
      if (key.startsWith('alphix:cache:')) {
        keysToRemove.push(key);
      }

      // Remove old activity:* keys (activity feed removed)
      if (key.startsWith('activity:')) {
        keysToRemove.push(key);
      }

      // Remove old pool:* keys (migrated to Redis)
      if (key.startsWith('pool:stats:') || key.startsWith('pool:state:') || key.startsWith('pool:chart:')) {
        keysToRemove.push(key);
      }

      // Remove old user:positions:* keys (now uses derivePositionsFromIds)
      if (key.startsWith('user:positions:')) {
        keysToRemove.push(key);
      }

      // Keep userPositionIds_* keys (still used for localStorage-only position IDs)
    }

    // Remove all deprecated keys
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    if (keysToRemove.length > 0) {
      console.log(`[Cache] Cleaned up ${keysToRemove.length} deprecated cache entries from pre-Redis system`);
    }
  } catch (error) {
    console.warn('[Cache] Failed to clear deprecated caches:', error);
  }
}

export { derivePositionsFromIds, decodePositionInfo } from './on-chain-data';