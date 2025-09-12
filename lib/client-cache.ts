import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { formatUnits } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { getPositionDetails, getPoolState } from './liquidity-utils';
import { publicClient } from './viemClient';
import { parseAbi } from 'viem';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from './abis/state_view_abi';
import { getStateViewAddress, getPositionManagerAddress } from './pools-config';
import { getToken as getTokenConfig, getTokenSymbolByAddress, CHAIN_ID } from './pools-config';
import type { Address } from 'viem';
import { position_manager_abi } from './abis/PositionManager_abi';
import { SafeStorage } from './safe-storage';
import { RetryUtility } from './retry-utility';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const LONG_CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes for stable data
const TEN_MINUTES_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const appCache: Record<string, CacheEntry<any>> = {};

// Request deduplication: track ongoing requests to prevent duplicates
const ongoingRequests = new Map<string, Promise<any>>();

// Indexing barriers: gate fresh fetches until subgraph head reaches tx block
const indexingBarriers = new Map<string, Promise<boolean>>();

export function setIndexingBarrier(ownerAddress: string, barrier: Promise<boolean>): void {
  const key = (ownerAddress || '').toLowerCase();
  indexingBarriers.set(key, barrier);
  // IMPORTANT: If a fresh barrier is set, do not allow any in-flight IDs request to complete and poison cache.
  // Purge the ongoing request for this owner's position IDs so subsequent callers won't reuse a pre-barrier promise.
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

export function getIndexingBarrier(ownerAddress: string): Promise<boolean> | null {
  const key = (ownerAddress || '').toLowerCase();
  return indexingBarriers.get(key) || null;
}

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
export const getUserPositionsCacheKey = (ownerAddress: string) => `userPositions_${(ownerAddress || '').toLowerCase()}`;

// Function to generate a cache key for user position tokenIds
export const getUserPositionIdsCacheKey = (ownerAddress: string) => `userPositionIds_${(ownerAddress || '').toLowerCase()}`;

const IDS_TTL_MS = 60 * 60 * 1000; // 1h

type StoredIds = { ids: string[]; ts: number };
type StoredIdsWithMeta = { items: Array<{ id: string; createdAt?: number; lastTimestamp?: number }>; ts: number };

function readIdsFromLocalStorage(key: string): string[] | null {
  try {
    const raw = SafeStorage.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIds | StoredIdsWithMeta | null;
    if (!parsed || typeof (parsed as any).ts !== 'number') return null;
    if (Date.now() - (parsed as any).ts > IDS_TTL_MS) {
      SafeStorage.remove(key);
      return null;
    }
    if (Array.isArray((parsed as any).ids)) return (parsed as StoredIds).ids;
    if (Array.isArray((parsed as any).items)) return (parsed as StoredIdsWithMeta).items.map(x => x.id);
    return null;
  } catch {
    return null;
  }
}

function writeIdsToLocalStorage(key: string, ids: string[]): void {
  try {
    SafeStorage.set(key, JSON.stringify({ ids, ts: Date.now() }));
  } catch {}
}

// Explicit invalidation helpers for user positions and ids
export function invalidateUserPositionsCache(ownerAddress: string): void {
  const key = getUserPositionsCacheKey(ownerAddress);
  invalidateCacheEntry(key);
}

export function invalidateUserPositionIdsCache(ownerAddress: string): void {
  const key = getUserPositionIdsCacheKey(ownerAddress);
  invalidateCacheEntry(key);
  SafeStorage.remove(key);
}

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

// Unified loader for user positions with request deduplication
// Returns cached data when available; otherwise performs a single shared fetch and caches the result.
export async function loadUserPositions(ownerAddress: string): Promise<any[]> {
  const key = getUserPositionsCacheKey(ownerAddress);
  const cached = getFromCache<any[]>(key);
  if (cached) return cached;

  const ongoing = getOngoingRequest<any[]>(key);
  if (ongoing) return ongoing;

  const promise = (async () => {
    const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${ownerAddress}` as any, { cache: 'no-store' as any } as any);
    const data = await res.json();
    const positions = Array.isArray(data) ? data : [];
    setToCache(key, positions);
    return positions;
  })();

  return setOngoingRequest(key, promise);
}

// --- Uncollected fees (per position) client cache ---
export const getUncollectedFeesCacheKey = (positionId: string) => `uncollectedFees_${String(positionId)}`;

export function invalidateUncollectedFeesCache(positionId: string): void {
  invalidateCacheEntry(getUncollectedFeesCacheKey(positionId));
}

// Cache TTL: keep short (e.g., 60s) to avoid stale UX while still preventing spam on toggle
export async function loadUncollectedFees(positionId: string, ttlMs: number = 60 * 1000): Promise<{ amount0: string; amount1: string } | null> {
  const key = getUncollectedFeesCacheKey(positionId);
  const cached = getFromCacheWithTtl<{ amount0: string; amount1: string }>(key, ttlMs);
  if (cached) return cached;
  const ongoing = getOngoingRequest<{ amount0: string; amount1: string }>(key);
  if (ongoing) return ongoing;

  const promise = (async () => {
    try {
      const resp = await fetch('/api/liquidity/get-uncollected-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId }),
      } as any);
      const json = await resp.json();
      if (!resp.ok || !json?.success) return null;
      const data = { amount0: String(json.amount0 ?? '0'), amount1: String(json.amount1 ?? '0') };
      setToCache(key, data);
      return data;
    } catch {
      return null;
    }
  })();

  return setOngoingRequest(key, promise);
}

// --- Batched uncollected fees (centralized) ---
export type UncollectedFeesItem = {
  positionId: string;
  amount0: string; // raw smallest units as string
  amount1: string; // raw smallest units as string
  token0Symbol: string;
  token1Symbol: string;
  formattedAmount0?: string; // human readable
  formattedAmount1?: string; // human readable
};

const getUncollectedFeesBatchCacheKey = (positionIds: string[]) => `uncollectedFeesBatch_${positionIds.slice().sort().join(',')}`;

export async function loadUncollectedFeesBatch(positionIds: string[], ttlMs: number = 60 * 1000): Promise<UncollectedFeesItem[]> {
  const ids = (positionIds || []).map(String).filter(Boolean);
  if (ids.length === 0) return [];

  const key = getUncollectedFeesBatchCacheKey(ids);
  const cached = getFromCacheWithTtl<UncollectedFeesItem[]>(key, ttlMs);
  if (cached) return cached;

  const ongoing = getOngoingRequest<UncollectedFeesItem[]>(key);
  if (ongoing) return ongoing;

  const promise = (async () => {
    try {
      const resp = await fetch('/api/liquidity/get-uncollected-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionIds: ids }),
      } as any);
      const json = await resp.json();

      if (!resp.ok || !json?.success || !Array.isArray(json?.items)) {
        return [] as UncollectedFeesItem[];
      }

      const items = json.items as UncollectedFeesItem[];

      // Also warm individual per-id caches
      try {
        for (const it of items) {
          const singleKey = getUncollectedFeesCacheKey(it.positionId);
          setToCache(singleKey, { amount0: String(it.amount0 ?? '0'), amount1: String(it.amount1 ?? '0') });
        }
      } catch {}
      setToCache(key, items);
      return items;
    } catch {
      return [] as UncollectedFeesItem[];
    }
  })();

  return setOngoingRequest(key, promise);
}

// --- Portfolio activity cache helpers (client-side localStorage) ---
export function invalidateActivityCache(ownerAddress: string, first: number = 20): void {
  try {
    const owner = (ownerAddress || '').toLowerCase();
    const prefix = `activity:${owner}:${first}:`;

    // Since SafeStorage doesn't provide enumeration, we'll use direct localStorage access
    // but with error handling for private browsing
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const toDelete: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i) as string | null;
          if (key && key.startsWith(prefix)) toDelete.push(key);
        }
        toDelete.forEach((k) => SafeStorage.remove(k));
      } catch {
        // Silently handle private browsing or other storage errors
      }
    }
  } catch {}
}

// Minimal on-chain fee fetch with TTL cache (per pool)
export async function getPoolFeeBps(poolIdHex: string, ttlMs: number = 10 * 60 * 1000): Promise<number> {
  const key = `poolFeeBps_${(poolIdHex || '').toLowerCase()}`;
  const cached = getFromCacheWithTtl<number>(key, ttlMs);
  if (typeof cached === 'number' && cached >= 0) return cached;
  const ongoing = getOngoingRequest<number>(key);
  if (ongoing) return ongoing;

  const promise = (async () => {
    try {
      const stateViewAddr = getStateViewAddress();
      const abi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
      const slot0 = await publicClient.readContract({
        address: stateViewAddr as `0x${string}`,
        abi,
        functionName: 'getSlot0',
        args: [poolIdHex as `0x${string}`],
      }) as readonly [bigint, number, number, number];
      const lpFeeRaw = Number(slot0?.[3] ?? 3000);
      // Preserve hundredths of a basis point to avoid rounding drift in display
      const bps = Math.max(0, Math.round((((lpFeeRaw / 1_000_000) * 10_000) * 100)) / 100);
      setToCache(key, bps);
      return bps;
    } catch {
      setToCache(key, 30); // safe default 0.30%
      return 30;
    }
  })();

  return setOngoingRequest(key, promise);
}

// Load only tokenIds for an owner's positions (24h TTL by default)
export async function loadUserPositionIds(ownerAddress: string): Promise<string[]> {
  const key = getUserPositionIdsCacheKey(ownerAddress);
  // Prefer persistent localStorage first to survive reloads/HMR
  let stored = readIdsFromLocalStorage(key);
  // Back-compat: also check legacy (non-lowercased) key once
  if (!stored || stored.length === 0) {
    const legacyKey = `userPositionIds_${ownerAddress}`;
    const legacy = readIdsFromLocalStorage(legacyKey);
    if (legacy && legacy.length > 0) {
      stored = legacy;
    }
  }
  // Keep retained; harmless even if not used
  const barrierEarly = getIndexingBarrier(ownerAddress);
  if (stored && stored.length > 0 && !barrierEarly) {
    setToCache(key, stored);
    return stored;
  }
  const cached = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS);
  const barrierEarly2 = getIndexingBarrier(ownerAddress);
  if (cached && !barrierEarly2) return cached;
  // Only reuse an ongoing request if no barrier is present.
  // If a barrier exists, we must not attach to a pre-barrier promise which could return stale data.
  const barrierPresentForOngoing = getIndexingBarrier(ownerAddress);
  if (!barrierPresentForOngoing) {
    const ongoing = getOngoingRequest<string[]>(key);
    if (ongoing) return ongoing;
  } else {
    // Best-effort: drop any pre-existing ongoing promise for safety.
    try { ongoingRequests.delete(key); } catch {}
  }

  const promise = (async () => {
    // If an indexing barrier exists, wait for it before doing a fresh fetch
    try {
      const barrier = getIndexingBarrier(ownerAddress);
      if (barrier) {
        const ok = await barrier;
        if (!ok) {
          // Subgraph timed out. Do not write potentially stale results; prefer previously cached values.
          const fallback = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS) || stored || [];
          return fallback;
        }
      }
    } catch {}

    // Hints removed: single authority is the indexing barrier

    // Get previously cached positions to compare
    let previousPositionCount = 0;
    try {
      const previousCached = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS * 2); // Look further back
      if (previousCached) {
        previousPositionCount = previousCached.length;
      }
    } catch {}

    const result = await RetryUtility.execute(
      async () => {
        const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${ownerAddress}&idsOnly=1&withCreatedAt=1` as any, { cache: 'no-store' as any } as any);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const ids: string[] = [];
        const itemsPersist: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];

        if (Array.isArray(data)) {
          for (const item of data) {
            try {
              if (!item) continue;
              // More robust ID extraction to handle different formats
              let idStr = '';
              if (typeof item.id === 'string') {
                idStr = item.id;
              } else if (typeof item.id === 'number') {
                idStr = item.id.toString();
              } else if (typeof item.id === 'bigint') {
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

    // Extract results
    let lastResult: string[] = [];
    let itemsPersistForPersist: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];

    if (result.success && result.data) {
      lastResult = result.data.ids;
      itemsPersistForPersist = result.data.itemsPersist;
    }

    // Final barrier check BEFORE caching: if a barrier exists now, wait for it to resolve to avoid stale writes
    try {
      const barrierPost = getIndexingBarrier(ownerAddress);
      if (barrierPost) {
        const ok2 = await barrierPost;
        if (!ok2) {
          const fallback2 = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS) || stored || [];
          return fallback2;
        }
      }
    } catch {}

    // CRITICAL: Final barrier check before cache write to prevent race conditions
    // If a new barrier was set while we were fetching, abort cache write
    const finalBarrier = getIndexingBarrier(ownerAddress);
    if (finalBarrier) {
      // A new transaction started while we were fetching - don't cache potentially stale data
      const fallback3 = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS) || stored || [];
      return fallback3;
    }

    // Cache the final result (only if no barrier exists)
    setToCache(key, lastResult);
    try {
      if (typeof window !== 'undefined') {
        // Prefer server-provided createdAt/lastTimestamp (seconds). Fallback to current timestamp when unavailable
        const toStore = (itemsPersistForPersist.length > 0
          ? itemsPersistForPersist
          : lastResult.map(id => ({ id, createdAt: 0, lastTimestamp: Math.floor(Date.now() / 1000) }))
        );
        SafeStorage.set(key, JSON.stringify({ items: toStore, ts: Date.now() }));
        // No hint cleanup required
      }
    } catch {}
    return lastResult;
  })();

  return setOngoingRequest(key, promise);
}

// Helper moved from liquidity-utils to be self-contained
export interface DecodedPositionInfo {
    tickLower: number;
    tickUpper: number;
    hasSubscriber: boolean;
}
export function decodePositionInfo(value: bigint): DecodedPositionInfo {
    const toSigned24 = (raw: number): number => (raw >= 0x800000 ? raw - 0x1000000 : raw);
    const rawLower = Number((value >> 8n) & 0xFFFFFFn);
    const rawUpper = Number((value >> 32n) & 0xFFFFFFn);
    const hasSub = (value & 0xFFn) !== 0n;
    return {
        tickLower: toSigned24(rawLower),
        tickUpper: toSigned24(rawUpper),
        hasSubscriber: hasSub,
    };
}

// Derive full position data from tokenIds using current on-chain state
export async function derivePositionsFromIds(ownerAddress: string, tokenIds: Array<string | number | bigint>): Promise<any[]> {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return [];

  const pmAddress = getPositionManagerAddress() as Address;
  const stateViewAddr = getStateViewAddress() as Address;

  // 1. First Multicall: Get position info and liquidity for all tokenIds
  const positionDetailsContracts = tokenIds.flatMap(id => ([
    {
      address: pmAddress,
      abi: position_manager_abi as any,
      functionName: 'getPoolAndPositionInfo',
      args: [BigInt(String(id))],
    },
    {
      address: pmAddress,
      abi: position_manager_abi as any,
      functionName: 'getPositionLiquidity',
      args: [BigInt(String(id))],
    },
  ]));

  const positionDetailsResults = await publicClient.multicall({
    contracts: positionDetailsContracts,
    allowFailure: true,
  });

  // 2. Process first multicall results and gather unique pool keys
  const poolKeys = new Map<string, any>();
  const positionDataMap = new Map<string, any>();

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = String(tokenIds[i]);
    const infoResult = positionDetailsResults[i * 2];
    const liquidityResult = positionDetailsResults[i * 2 + 1];

    if (infoResult.status === 'success' && liquidityResult.status === 'success') {
      const [poolKey, infoValue] = infoResult.result as any;
      const liquidity = liquidityResult.result as bigint;

      const encodedPoolKey = encodeAbiParameters(
          [{ type: 'tuple', components: [
              { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
          ]}],
          [poolKey]
      );
      const poolIdHex = keccak256(encodedPoolKey) as Hex;

      if (!poolKeys.has(poolIdHex)) {
          poolKeys.set(poolIdHex, poolKey);
      }
      
      positionDataMap.set(tokenId, {
          poolId: poolIdHex,
          poolKey,
          infoValue,
          liquidity,
      });
    }
  }

  // 3. Second Multicall: Get state for all unique pools
  const uniquePoolIds = Array.from(poolKeys.keys());
  const poolStateContracts = uniquePoolIds.flatMap(poolId => ([
    {
      address: stateViewAddr,
      abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI as any),
      functionName: 'getSlot0',
      args: [poolId],
    },
    {
      address: stateViewAddr,
      abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI as any),
      functionName: 'getLiquidity',
      args: [poolId],
    },
  ]));

  const poolStateResults = await publicClient.multicall({
    contracts: poolStateContracts,
    allowFailure: true,
  });

  // 4. Process second multicall results
  const poolStateMap = new Map<string, any>();
  for (let i = 0; i < uniquePoolIds.length; i++) {
    const poolId = uniquePoolIds[i];
    const slot0Result = poolStateResults[i * 2];
    const liquidityResult = poolStateResults[i * 2 + 1];

    if (slot0Result.status === 'success' && liquidityResult.status === 'success') {
      const [sqrtPriceX96, tick] = slot0Result.result as any;
      const poolLiquidity = liquidityResult.result as bigint;
      poolStateMap.set(poolId, {
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick: Number(tick),
        poolLiquidity: poolLiquidity.toString(),
      });
    }
  }

  // 5. Final Assembly: Construct V4Position objects and derive amounts
  const createdAtMap = new Map<string, number>();
  try {
      const raw = SafeStorage.get(getUserPositionIdsCacheKey(ownerAddress));
      if (raw) {
          const parsed = JSON.parse(raw) as any;
          if (parsed && Array.isArray(parsed.items)) {
              for (const it of parsed.items) {
                  if (it && it.id) createdAtMap.set(String(it.id), Number(it.createdAt || 0));
              }
          }
      }
  } catch {}

  const out: any[] = [];
  for (const tokenIdStr of tokenIds.map(String)) {
    try {
      const positionData = positionDataMap.get(tokenIdStr);
      if (!positionData) continue;
      
      const poolState = poolStateMap.get(positionData.poolId);
      if (!poolState) continue;

      const { poolKey, infoValue, liquidity } = positionData;
      
      const t0Addr = poolKey.currency0 as Address;
      const t1Addr = poolKey.currency1 as Address;
      const sym0 = getTokenSymbolByAddress(t0Addr) || 'T0';
      const sym1 = getTokenSymbolByAddress(t1Addr) || 'T1';
      const cfg0 = sym0 ? getTokenConfig(sym0) : undefined;
      const cfg1 = sym1 ? getTokenConfig(sym1) : undefined;
      const dec0 = cfg0?.decimals ?? 18;
      const dec1 = cfg1?.decimals ?? 18;
      const tok0 = new Token(CHAIN_ID, t0Addr, dec0, sym0);
      const tok1 = new Token(CHAIN_ID, t1Addr, dec1, sym1);

      const v4Pool = new V4Pool(
        tok0, tok1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks,
        JSBI.BigInt(poolState.sqrtPriceX96),
        JSBI.BigInt(poolState.poolLiquidity),
        poolState.tick
      );

      const { tickLower, tickUpper } = decodePositionInfo(infoValue);

      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower,
        tickUpper,
        liquidity: JSBI.BigInt(liquidity.toString()),
      });

      const raw0 = BigInt(v4Position.amount0.quotient.toString());
      const raw1 = BigInt(v4Position.amount1.quotient.toString());
      
      let created = createdAtMap.get(tokenIdStr) || 0;
      if (created > 1e12) created = Math.floor(created / 1000);

      out.push({
        positionId: tokenIdStr,
        poolId: positionData.poolId,
        token0: { address: tok0.address, symbol: tok0.symbol || 'T0', amount: formatUnits(raw0, tok0.decimals), rawAmount: raw0.toString() },
        token1: { address: tok1.address, symbol: tok1.symbol || 'T1', amount: formatUnits(raw1, tok1.decimals), rawAmount: raw1.toString() },
        tickLower,
        tickUpper,
        liquidityRaw: liquidity.toString(),
        ageSeconds: created > 0 ? Math.max(0, Math.floor(Date.now()/1000) - created) : 0,
        blockTimestamp: String(created || '0'),
        isInRange: poolState.tick >= tickLower && poolState.tick < tickUpper,
      });
    } catch (e) {
      console.warn(`[derivePositionsFromIds] Error processing tokenId ${tokenIdStr}:`, e);
    }
  }
  return out;
}

// ---- Subgraph head waiter ----
export async function waitForSubgraphBlock(targetBlock: number, opts?: { timeoutMs?: number; minWaitMs?: number; maxIntervalMs?: number }): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const minWaitMs = opts?.minWaitMs ?? 800;
  const maxIntervalMs = opts?.maxIntervalMs ?? 1200;

  const start = Date.now();
  let interval = 250;
  const jitter = () => Math.floor(Math.random() * 80);

  try {
    // small initial wait to smooth indexing jitter
    await new Promise((r) => setTimeout(r, minWaitMs));
    for (;;) {
      if (Date.now() - start > timeoutMs) return false;
      const resp = await fetch('/api/liquidity/subgraph-head', { cache: 'no-store' as any } as any);
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