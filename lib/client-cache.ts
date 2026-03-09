/**
 * Client-Side Cache Utilities
 *
 * Provides client-side caching and coordination:
 * - Request deduplication (prevents duplicate in-flight requests)
 * - User position IDs (localStorage-based, 24h TTL)
 */

import { SafeStorage } from './safe-storage';
import { RetryUtility } from './retry-utility';
import type { NetworkMode } from './network-mode';
import { ALL_MODES } from './chain-registry';

// Request deduplication: track ongoing requests to prevent duplicates
const ongoingRequests = new Map<string, Promise<any>>();

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
 * Cache key for user position IDs in localStorage.
 * Includes network mode to prevent data contamination between chains.
 */
function getUserPositionIdsCacheKey(address: string, networkMode: NetworkMode): string {
  return `${networkMode}:userPositionIds_${address.toLowerCase()}`;
}

/** Invalidate user position IDs cache for a specific chain */
export function invalidateUserPositionIdsCache(ownerAddress: string, networkMode: NetworkMode): void {
  try { SafeStorage.remove(getUserPositionIdsCacheKey(ownerAddress, networkMode)); } catch {}
}

/** Invalidate user position IDs cache across ALL chains */
export function invalidateAllChainsPositionIdsCache(ownerAddress: string): void {
  for (const mode of ALL_MODES) {
    invalidateUserPositionIdsCache(ownerAddress, mode);
  }
}

/** Time window (ms) to preserve optimistic entries that aren't in subgraph yet */
const OPTIMISTIC_ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Add a position ID directly to the cache (from transaction receipt).
 * This bypasses subgraph and ensures the position is immediately visible.
 */
export function addPositionIdToCache(ownerAddress: string, tokenId: string, networkMode: NetworkMode, createdAt?: number): void {
  if (!ownerAddress || !tokenId) return;

  const key = getUserPositionIdsCacheKey(ownerAddress, networkMode);
  const now = Date.now();
  const timestamp = createdAt || Math.floor(now / 1000);

  try {
    const raw = SafeStorage.get(key);
    let items: Array<{ id: string; createdAt?: number; lastTimestamp?: number; optimisticAddedAt?: number }> = [];
    let cacheTimestamp = now;

    if (raw) {
      const parsed = JSON.parse(raw);
      items = parsed.items || [];
      cacheTimestamp = parsed.timestamp || now;
    }

    const existingIdx = items.findIndex(it => it.id === tokenId);
    if (existingIdx === -1) {
      items.unshift({ id: tokenId, createdAt: timestamp, lastTimestamp: timestamp, optimisticAddedAt: now });
      SafeStorage.set(key, JSON.stringify({ items, timestamp: cacheTimestamp }));
    } else if (!items[existingIdx].optimisticAddedAt) {
      items[existingIdx].optimisticAddedAt = now;
      SafeStorage.set(key, JSON.stringify({ items, timestamp: cacheTimestamp }));
    }
  } catch {}
}

/** Remove a position ID from the cache (after full burn) */
export function removePositionIdFromCache(ownerAddress: string, tokenId: string, networkMode: NetworkMode): void {
  if (!ownerAddress || !tokenId) return;

  const key = getUserPositionIdsCacheKey(ownerAddress, networkMode);

  try {
    const raw = SafeStorage.get(key);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const items = parsed.items || [];
    const filtered = items.filter((it: any) => it.id !== tokenId);

    if (filtered.length !== items.length) {
      SafeStorage.set(key, JSON.stringify({ items: filtered, timestamp: parsed.timestamp || Date.now() }));
    }
  } catch {}
}

/** Get cached timestamps map for position APY calculation */
export function getCachedPositionTimestamps(ownerAddress: string, networkMode: NetworkMode): Map<string, { createdAt: number; lastTimestamp: number }> {
  const map = new Map<string, { createdAt: number; lastTimestamp: number }>();
  if (!ownerAddress) return map;
  try {
    const raw = SafeStorage.get(getUserPositionIdsCacheKey(ownerAddress, networkMode));
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
 * Load user position IDs with stale-while-revalidate pattern.
 * Returns cached data immediately (if available) and always refreshes in background.
 */
export async function loadUserPositionIds(
  ownerAddress: string,
  networkMode: NetworkMode,
  options?: LoadPositionIdsOptions
): Promise<string[]> {
  if (!ownerAddress) return [];

  const key = getUserPositionIdsCacheKey(ownerAddress, networkMode);

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

  // SWR: If we have cached data, return it and refresh in background
  if (cachedIds.length > 0) {
    if (options?.onRefreshed) {
      refreshPositionIdsInBackground(ownerAddress, key, cachedIds, networkMode, options.onRefreshed);
    }
    return cachedIds;
  }

  // No cached data - must wait for fetch
  const freshIds = await fetchAndCachePositionIds(ownerAddress, key, networkMode);
  return freshIds || [];
}

/**
 * Refresh position IDs in background (stale-while-revalidate)
 */
function refreshPositionIdsInBackground(
  ownerAddress: string,
  cacheKey: string,
  currentIds: string[],
  networkMode: NetworkMode,
  onRefreshed?: (ids: string[]) => void
): void {
  const ongoing = getOngoingRequest<string[]>(cacheKey);
  if (ongoing) {
    ongoing.then((ids) => {
      if (onRefreshed && !arraysEqual(ids, currentIds)) {
        onRefreshed(ids);
      }
    }).catch(() => {});
    return;
  }

  const promise = fetchAndCachePositionIds(ownerAddress, cacheKey, networkMode).then((freshIds) => {
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
  cacheKey: string,
  networkMode: NetworkMode
): Promise<string[] | null> {
  const result = await RetryUtility.execute(
    async () => {
      const res = await fetch(
        `/api/liquidity/get-positions?ownerAddress=${ownerAddress}&idsOnly=1&withCreatedAt=1&networkMode=${networkMode}`,
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

  // Preserve optimistic entries not yet indexed by subgraph
  const now = Date.now();
  let mergedItems = [...itemsPersist];
  const apiIdSet = new Set(ids);

  try {
    const existingRaw = SafeStorage.get(cacheKey);
    if (existingRaw) {
      const existingItems = JSON.parse(existingRaw).items || [];
      for (const item of existingItems) {
        if (
          item.optimisticAddedAt &&
          !apiIdSet.has(item.id) &&
          (now - item.optimisticAddedAt) < OPTIMISTIC_ENTRY_TTL_MS
        ) {
          mergedItems.unshift(item);
          ids.unshift(item.id);
        }
      }
    }
  } catch {}

  try {
    SafeStorage.set(cacheKey, JSON.stringify({ items: mergedItems, timestamp: now }));
  } catch {}

  return ids;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

export { derivePositionsFromIds, decodePositionInfo } from './on-chain-data';
