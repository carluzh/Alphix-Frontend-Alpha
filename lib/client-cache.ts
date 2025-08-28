import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { formatUnits } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { getPositionDetails, getPoolState } from './liquidity-utils';
import { publicClient } from './viemClient';
import { parseAbi } from 'viem';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from './abis/state_view_abi';
import { getStateViewAddress } from './pools-config';
import { getToken as getTokenConfig, getTokenSymbolByAddress, CHAIN_ID } from './pools-config';
import type { Address } from 'viem';
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
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIds | StoredIdsWithMeta | null;
    if (!parsed || typeof (parsed as any).ts !== 'number') return null;
    if (Date.now() - (parsed as any).ts > IDS_TTL_MS) {
      window.localStorage.removeItem(key);
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
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ids, ts: Date.now() }));
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
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(key); } catch {}
  }
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

// --- Portfolio activity cache helpers (client-side localStorage) ---
export function invalidateActivityCache(ownerAddress: string, first: number = 20): void {
  if (typeof window === 'undefined') return;
  try {
    const owner = (ownerAddress || '').toLowerCase();
    const prefix = `activity:${owner}:${first}:`;
    const toDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) as string | null;
      if (key && key.startsWith(prefix)) toDelete.push(key);
    }
    toDelete.forEach((k) => window.localStorage.removeItem(k));
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
      const bps = Math.max(0, Math.round((lpFeeRaw / 1_000_000) * 10_000));
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
  if (stored && stored.length > 0) {
    setToCache(key, stored);
    return stored;
  }
  const cached = getFromCacheWithTtl<string[]>(key, IDS_TTL_MS);
  if (cached) return cached;
  const ongoing = getOngoingRequest<string[]>(key);
  if (ongoing) return ongoing;

  const promise = (async () => {
    const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${ownerAddress}&idsOnly=1&withCreatedAt=1` as any, { cache: 'no-store' as any } as any);
    if (!res.ok) return [] as string[];
    const data = await res.json();
    const ids: string[] = [];
    const itemsPersist: Array<{ id: string; createdAt?: number; lastTimestamp?: number }> = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        try {
          if (!item) continue;
          const idStr = typeof item.id === 'string' ? item.id : String((item as any).id || '');
          if (idStr) {
            ids.push(idStr);
            itemsPersist.push({ id: idStr, createdAt: Number((item as any)?.createdAt || 0), lastTimestamp: Number((item as any)?.lastTimestamp || 0) });
          }
        } catch {}
      }
    }
    setToCache(key, ids);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify({ items: itemsPersist, ts: Date.now() }));
      }
    } catch {}
    return ids;
  })();

  return setOngoingRequest(key, promise);
}

// Derive full position data from tokenIds using current on-chain state
export async function derivePositionsFromIds(ownerAddress: string, tokenIds: Array<string | number | bigint>): Promise<any[]> {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return [];
  const stateCache = new Map<string, { sqrtPriceX96: string; tick: number; poolLiquidity: string }>();
  // Read createdAt map if available
  const createdAtMap = new Map<string, number>();
  const lastTsMap = new Map<string, number>();
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(getUserPositionIdsCacheKey(ownerAddress));
      if (raw) {
        const parsed = JSON.parse(raw) as StoredIdsWithMeta | null;
        if (parsed && Array.isArray(parsed.items)) {
          for (const it of parsed.items) {
            if (it && it.id) {
              createdAtMap.set(String(it.id), Number(it.createdAt || 0));
              lastTsMap.set(String(it.id), Number(it.lastTimestamp || 0));
            }
          }
        }
      }
    }
  } catch {}
  const out: any[] = [];
  for (const idLike of tokenIds) {
    try {
      const nftTokenId = BigInt(String(idLike));
      const details = await getPositionDetails(nftTokenId);
      const encodedPoolKey = encodeAbiParameters([
        { type: 'tuple', components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ]}
      ], [{
        currency0: details.poolKey.currency0 as `0x${string}`,
        currency1: details.poolKey.currency1 as `0x${string}`,
        fee: Number(details.poolKey.fee),
        tickSpacing: Number(details.poolKey.tickSpacing),
        hooks: details.poolKey.hooks as `0x${string}`,
      }]);
      const poolIdHex = keccak256(encodedPoolKey) as Hex;
      const poolIdStr = poolIdHex;

      let state = stateCache.get(poolIdStr);
      if (!state) {
        const ps = await getPoolState(poolIdHex);
        state = { sqrtPriceX96: ps.sqrtPriceX96.toString(), tick: Number(ps.tick), poolLiquidity: ps.liquidity.toString() };
        stateCache.set(poolIdStr, state);
      }

      const t0Addr = details.poolKey.currency0 as Address;
      const t1Addr = details.poolKey.currency1 as Address;
      const sym0 = getTokenSymbolByAddress(t0Addr) || 'T0';
      const sym1 = getTokenSymbolByAddress(t1Addr) || 'T1';
      const cfg0 = sym0 ? getTokenConfig(sym0) : undefined;
      const cfg1 = sym1 ? getTokenConfig(sym1) : undefined;
      const dec0 = cfg0?.decimals ?? 18;
      const dec1 = cfg1?.decimals ?? 18;
      const tok0 = new Token(CHAIN_ID, t0Addr, dec0, sym0);
      const tok1 = new Token(CHAIN_ID, t1Addr, dec1, sym1);

      const v4Pool = new V4Pool(
        tok0,
        tok1,
        details.poolKey.fee,
        details.poolKey.tickSpacing,
        details.poolKey.hooks,
        state.sqrtPriceX96,
        JSBI.BigInt(state.poolLiquidity),
        state.tick
      );
      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        liquidity: JSBI.BigInt(details.liquidity.toString()),
      });

      const raw0 = BigInt(v4Position.amount0.quotient.toString());
      const raw1 = BigInt(v4Position.amount1.quotient.toString());

      const lastTs = lastTsMap.get(String(nftTokenId)) || 0;
      out.push({
        positionId: String(nftTokenId),
        poolId: poolIdStr,
        token0: { address: tok0.address, symbol: tok0.symbol || 'T0', amount: formatUnits(raw0, tok0.decimals), rawAmount: raw0.toString() },
        token1: { address: tok1.address, symbol: tok1.symbol || 'T1', amount: formatUnits(raw1, tok1.decimals), rawAmount: raw1.toString() },
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        liquidityRaw: details.liquidity.toString(),
        ageSeconds: (() => {
          const created = createdAtMap.get(String(nftTokenId)) || 0;
          return created > 0 ? Math.max(0, Math.floor(Date.now()/1000) - created) : 0;
        })(),
        blockTimestamp: (() => {
          const created = createdAtMap.get(String(nftTokenId)) || 0;
          return String(created || '0');
        })(),
        // last modified removed from UI; keep internal maps harmlessly
        isInRange: state.tick >= details.tickLower && state.tick < details.tickUpper,
      });
    } catch (e) {
      // swallow one-off errors per id
    }
  }
  return out;
}