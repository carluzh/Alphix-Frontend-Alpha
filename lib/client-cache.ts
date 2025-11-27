/**
 * Client-Side Cache Utilities
 *
 * This module provides ONLY client-side caching and coordination utilities.
 * Server-side caching has been MIGRATED to Redis (lib/redis.ts) with Upstash.
 *
 * What's here (still used):
 * - Request deduplication (prevents duplicate in-flight requests)
 * - Indexing barriers (coordinates fetches until subgraph syncs)
 * - User position IDs (localStorage-based, client-only, 24h TTL)
 * - Subgraph sync waiter
 *
 * What's DEPRECATED (migrated to Redis):
 * - Pool data caching → Now: Redis + /api/liquidity/get-pools-batch
 * - Pool stats/state → Now: Redis (no longer cached - removed from invalidation)
 * - Fees caching → Now: Redis + /api/fees/get-batch
 * - Activity caching → Removed entirely (activity feed no longer displayed)
 * - Chart data → Now: Redis + /api/liquidity/pool-chart-data
 * - In-memory cache → Replaced with Upstash Redis (persistent, server-side)
 *
 * Migration Complete: All server-side caching now uses Redis with stale-while-revalidate pattern.
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

/**
 * Invalidate user position IDs cache in localStorage
 */
export function invalidateUserPositionIdsCache(ownerAddress: string): void {
  const key = getUserPositionIdsCacheKey(ownerAddress);
  try {
    SafeStorage.remove(key);
  } catch {}
}

/**
 * Load user position IDs from API with localStorage caching (client-side only)
 *
 * Position IDs are stored in localStorage with 24h TTL.
 * This is client-side only because IDs don't change often and localStorage provides persistence.
 *
 * @param ownerAddress - User wallet address
 * @returns Array of position token IDs
 */
export async function loadUserPositionIds(ownerAddress: string): Promise<string[]> {
  if (!ownerAddress) return [];

  const key = getUserPositionIdsCacheKey(ownerAddress);
  const IDS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Check localStorage cache first
  let stored: any = null;
  try {
    const raw = SafeStorage.get(key);
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      const age = Date.now() - (parsed?.timestamp || 0);
      if (age < IDS_TTL_MS && Array.isArray(parsed?.items)) {
        stored = parsed;
        // Return cached IDs if fresh enough
        const ids = parsed.items.map((it: any) => String(it?.id || '')).filter(Boolean);
        return ids;
      }
    }
  } catch {}

  // Check for indexing barrier before fetching
  const barrierEarly = getIndexingBarrier(ownerAddress);
  if (barrierEarly) {
    // If barrier exists, we may return stale cache until barrier clears
    if (stored && stored.items) {
      const ids = stored.items.map((it: any) => String(it?.id || '')).filter(Boolean);
      return ids;
    }
  }

  // Check for ongoing request (deduplication)
  const barrierPresentForOngoing = getIndexingBarrier(ownerAddress);
  if (!barrierPresentForOngoing) {
    const ongoing = getOngoingRequest<string[]>(key);
    if (ongoing) return ongoing;
  } else {
    // Drop any pre-existing ongoing promise for safety
    try { ongoingRequests.delete(key); } catch {}
  }

  const promise = (async () => {
    // Wait for indexing barrier if present
    try {
      const barrier = getIndexingBarrier(ownerAddress);
      if (barrier) {
        const ok = await barrier;
        if (!ok) {
          // Subgraph timed out - return cached fallback
          if (stored && stored.items) {
            const ids = stored.items.map((it: any) => String(it?.id || '')).filter(Boolean);
            return ids;
          }
          return [];
        }
      }
    } catch {}

    // Fetch from API
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

    let lastResult: string[] = [];
    let itemsPersistForPersist: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];

    if (result.success && result.data) {
      lastResult = result.data.ids;
      itemsPersistForPersist = result.data.itemsPersist;
    }

    // Wait for final barrier check before caching
    try {
      const barrierFinal = getIndexingBarrier(ownerAddress);
      if (barrierFinal) {
        const ok = await barrierFinal;
        if (!ok) {
          // Don't cache potentially stale results
          return lastResult;
        }
      }
    } catch {}

    // Cache to localStorage
    try {
      SafeStorage.set(key, JSON.stringify({
        items: itemsPersistForPersist,
        timestamp: Date.now()
      }));
    } catch {}

    return lastResult;
  })();

  return setOngoingRequest(key, promise);
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

/**
 * Re-export on-chain data utilities
 * These are pure on-chain functions used for position data (not cached server-side)
 */
export { derivePositionsFromIds, decodePositionInfo } from './on-chain-data';

// All deprecated cache functions removed (2025-11-27 Phase 0 cleanup).
// Server-side caching is handled by Redis via API endpoints.
// For user positions: use derivePositionsFromIds (re-exported from on-chain-data.ts)
// For fees: use /api/fees/get-batch