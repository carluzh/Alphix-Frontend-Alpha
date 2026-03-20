'use client';

/**
 * useWSPools Hook
 *
 * Hook for accessing all pool metrics across ALL chains.
 * Pattern: Single REST load (all chains) → WebSocket real-time updates.
 *
 * The backend /pools/metrics endpoint (no ?network= param) returns pools
 * for every chain in a single response (~1s). This avoids per-chain fetching
 * and ensures both chain tables populate simultaneously.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWebSocketOptional } from '../WebSocketProvider';
import { fetchAllPoolsMetrics, type PoolMetrics } from '../../backend-client';
import { parseNetworkMode } from '../../network-mode';
import type { PoolData } from './useWSPool';

interface UseWSPoolsReturn {
  pools: PoolData[];
  poolsMap: Map<string, PoolData>;
  isLoading: boolean;
  error: Error | null;
  isConnected: boolean;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
}

// =============================================================================
// MODULE-LEVEL CACHE (persists across component mounts for instant navigation)
// =============================================================================

let poolsCache: { pools: Map<string, PoolData>; timestamp: number } | null = null;
const CACHE_TTL = 2 * 60_000;
const CACHE_FRESH_TTL = 30_000;

function getCachedPools(): { pools: Map<string, PoolData>; isStale: boolean } | null {
  if (!poolsCache) return null;
  const age = Date.now() - poolsCache.timestamp;
  if (age > CACHE_TTL) return null;
  return { pools: poolsCache.pools, isStale: age > CACHE_FRESH_TTL };
}

function setCachedPools(pools: Map<string, PoolData>): void {
  poolsCache = { pools: new Map(pools), timestamp: Date.now() };
}

// =============================================================================
// UTILS
// =============================================================================

function calculateApy(fees24hUsd: number, tvlUsd: number): number {
  if (tvlUsd <= 0) return 0;
  const dailyRate = fees24hUsd / tvlUsd;
  return ((1 + dailyRate) ** 365 - 1) * 100;
}

function toPoolData(metrics: PoolMetrics): PoolData {
  return {
    poolId: metrics.poolId,
    name: metrics.name,
    network: metrics.network,
    networkMode: parseNetworkMode(metrics.network),
    tvlUsd: metrics.tvlUsd,
    volume24hUsd: metrics.volume24hUsd,
    fees24hUsd: metrics.fees24hUsd,
    lendingYield24hUsd: metrics.lendingYield24hUsd,
    totalFees24hUsd: metrics.totalFees24hUsd,
    lpFee: metrics.lpFee,
    tvlToken0Usd: metrics.tvlToken0Usd,
    tvlToken1Usd: metrics.tvlToken1Usd,
    cumulativeFeesUsd: metrics.cumulativeFeesUsd,
    token0Price: metrics.token0Price,
    token1Price: metrics.token1Price,
    swapApy: metrics.swapApy,
    lendingApy: metrics.lendingApy,
    totalApy: metrics.totalApy,
    apy24h: metrics.totalApy ?? 0,
    lastUpdated: metrics.timestamp,
  };
}

// =============================================================================
// HOOK
// =============================================================================

export function useWSPools(): UseWSPoolsReturn {
  const ws = useWebSocketOptional();
  const fetchInProgressRef = useRef(false);

  const cachedData = getCachedPools();
  const [restPools, setRestPools] = useState<Map<string, PoolData>>(
    () => cachedData?.pools ?? new Map()
  );
  const [isLoading, setIsLoading] = useState(!cachedData?.pools?.size);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(
    cachedData?.pools?.size ? Date.now() : null
  );

  const isConnected = ws?.isConnected ?? false;

  // Fetch ALL chains in a single request (no ?network= param)
  const fetchPools = useCallback(async (isBackgroundRefresh = false) => {
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;

    try {
      if (!isBackgroundRefresh) setError(null);

      console.log('[useWSPools] Fetching all pools via REST...');
      const result = await fetchAllPoolsMetrics();
      console.log(`[useWSPools] REST response: success=${result.success}, pools=${result.pools?.length ?? 0}, error=${result.error ?? 'none'}`);

      if (result.success && result.pools.length > 0) {
        const poolsMap = new Map<string, PoolData>();
        for (const pool of result.pools) {
          poolsMap.set(pool.poolId.toLowerCase(), toPoolData(pool));
        }
        setRestPools(poolsMap);
        setCachedPools(poolsMap);
        setLastUpdated(Date.now());
        console.log(`[useWSPools] REST: ${result.pools.length} pools (all chains)`);
      } else if (!isBackgroundRefresh) {
        throw new Error(result.error || 'Failed to fetch pools');
      }
    } catch (err) {
      console.error('[useWSPools] Failed to fetch pools:', err);
      if (!isBackgroundRefresh) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      setIsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    const cached = getCachedPools();
    if (cached) {
      setRestPools(cached.pools);
      setIsLoading(false);
      if (cached.isStale) fetchPools(true);
      return;
    }
    fetchPools();
  }, [fetchPools]);

  // Poll — faster when WS is disconnected
  useEffect(() => {
    const interval = isConnected ? 60_000 : 45_000;
    const intervalId = setInterval(() => fetchPools(true), interval);
    return () => clearInterval(intervalId);
  }, [isConnected, fetchPools]);

  // Merge WebSocket data with REST data (WS takes precedence for its network)
  const poolsMap = useMemo((): Map<string, PoolData> => {
    const merged = new Map<string, PoolData>();

    restPools.forEach((pool, key) => {
      merged.set(key, pool);
    });

    if (ws?.pools) {
      ws.pools.forEach((wsPool, key) => {
        merged.set(key, {
          poolId: wsPool.poolId,
          name: wsPool.name,
          network: wsPool.network,
          networkMode: parseNetworkMode(wsPool.network),
          tvlUsd: wsPool.tvlUsd,
          volume24hUsd: wsPool.volume24hUsd,
          fees24hUsd: wsPool.fees24hUsd,
          lendingYield24hUsd: wsPool.lendingYield24hUsd,
          totalFees24hUsd: wsPool.totalFees24hUsd,
          lpFee: wsPool.lpFee,
          tvlToken0Usd: wsPool.tvlToken0Usd,
          tvlToken1Usd: wsPool.tvlToken1Usd,
          cumulativeFeesUsd: wsPool.cumulativeFeesUsd,
          token0Price: wsPool.token0Price,
          token1Price: wsPool.token1Price,
          swapApy: wsPool.swapApy,
          lendingApy: wsPool.lendingApy,
          totalApy: wsPool.totalApy,
          apy24h: wsPool.totalApy ?? 0,
          lastUpdated: wsPool.timestamp,
        });
      });
    }

    // Only update cache when REST data is present — prevents WS-only data
    // (single chain) from poisoning the module-level cache
    if (merged.size > 0 && restPools.size > 0) {
      setCachedPools(merged);
    }

    return merged;
  }, [ws?.pools, restPools]);

  const pools = useMemo(() => Array.from(poolsMap.values()), [poolsMap]);

  useEffect(() => {
    if (pools.length > 0) {
      const maxTimestamp = Math.max(...pools.map(p => p.lastUpdated));
      if (maxTimestamp > 0) {
        setLastUpdated(maxTimestamp);
      }
    }
  }, [pools]);

  return {
    pools,
    poolsMap,
    isLoading,
    error,
    isConnected,
    refresh: fetchPools,
    lastUpdated,
  };
}
