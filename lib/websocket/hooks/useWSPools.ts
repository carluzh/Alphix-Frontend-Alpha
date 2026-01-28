'use client';

/**
 * useWSPools Hook
 *
 * Hook for accessing all pool metrics from the WebSocket pools:metrics channel.
 * Pattern: Initial REST load from api.alphix.fi → WebSocket real-time updates.
 *
 * Features:
 * - Module-level cache for instant navigation (no flash on back/forward)
 * - WebSocket real-time updates when connected
 * - REST fallback with polling when WS disconnected
 *
 * Usage:
 * ```tsx
 * function PoolsTable() {
 *   const { pools, isLoading, isConnected } = useWSPools();
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <table>
 *       {pools.map(pool => (
 *         <tr key={pool.poolId}>
 *           <td>{pool.name}</td>
 *           <td>${pool.tvlUsd.toLocaleString()}</td>
 *           <td>${pool.volume24hUsd.toLocaleString()}</td>
 *           <td>{pool.apr24h.toFixed(2)}%</td>
 *         </tr>
 *       ))}
 *     </table>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWebSocketOptional } from '../WebSocketProvider';
import { useNetwork } from '../../network-context';
import { fetchPoolsMetrics, type PoolMetrics } from '../../backend-client';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pool data with calculated APR
 */
export interface PoolData {
  poolId: string;
  name: string;
  network: string;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  lpFee: number;
  token0Price: number;
  token1Price: number;
  /** Calculated: (fees24hUsd / tvlUsd) * 365 * 100 */
  apr24h: number;
  lastUpdated: number;
}

interface UseWSPoolsReturn {
  /** Array of all pool data */
  pools: PoolData[];
  /** Map of pool data by poolId (lowercase) for quick lookup */
  poolsMap: Map<string, PoolData>;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether there was an error fetching initial data */
  error: Error | null;
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Manually refresh pool data from REST */
  refresh: () => Promise<void>;
  /** Last update timestamp */
  lastUpdated: number | null;
}

// =============================================================================
// MODULE-LEVEL CACHE (persists across component mounts for instant navigation)
// =============================================================================

interface CachedPoolsData {
  pools: Map<string, PoolData>;
  timestamp: number;
  networkMode: string;
}

let poolsCache: CachedPoolsData | null = null;
const CACHE_TTL = 2 * 60_000; // 2 minute cache TTL (stale but usable)
const CACHE_FRESH_TTL = 30_000; // 30 seconds before background refresh

function getCachedPools(networkMode: string): { pools: Map<string, PoolData>; isStale: boolean } | null {
  if (!poolsCache) return null;
  if (poolsCache.networkMode !== networkMode) return null;

  const age = Date.now() - poolsCache.timestamp;
  if (age > CACHE_TTL) return null; // Too old, don't use

  return {
    pools: poolsCache.pools,
    isStale: age > CACHE_FRESH_TTL,
  };
}

function setCachedPools(pools: Map<string, PoolData>, networkMode: string): void {
  poolsCache = {
    pools: new Map(pools),
    timestamp: Date.now(),
    networkMode,
  };
}

// =============================================================================
// UTILS
// =============================================================================

/**
 * Calculate annualized APR from 24h fees and TVL
 */
function calculateApr(fees24hUsd: number, tvlUsd: number): number {
  if (tvlUsd <= 0) return 0;
  return (fees24hUsd / tvlUsd) * 365 * 100;
}

/**
 * Convert PoolMetrics to PoolData with calculated APR
 */
function toPoolData(metrics: PoolMetrics): PoolData {
  return {
    poolId: metrics.poolId,
    name: metrics.name,
    network: metrics.network,
    tvlUsd: metrics.tvlUsd,
    volume24hUsd: metrics.volume24hUsd,
    fees24hUsd: metrics.fees24hUsd,
    lpFee: metrics.lpFee,
    token0Price: metrics.token0Price,
    token1Price: metrics.token1Price,
    apr24h: calculateApr(metrics.fees24hUsd, metrics.tvlUsd),
    lastUpdated: metrics.timestamp,
  };
}

// =============================================================================
// HOOK
// =============================================================================

export function useWSPools(): UseWSPoolsReturn {
  const { networkMode } = useNetwork();
  const ws = useWebSocketOptional();
  const fetchInProgressRef = useRef(false);

  // Initialize state from cache if available (instant navigation)
  const cachedData = getCachedPools(networkMode);
  const [restPools, setRestPools] = useState<Map<string, PoolData>>(
    () => cachedData?.pools ?? new Map()
  );
  const [isLoading, setIsLoading] = useState(!cachedData?.pools?.size);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(
    cachedData?.pools?.size ? Date.now() : null
  );

  const isConnected = ws?.isConnected ?? false;

  // Fetch from REST (initial load and fallback when WS not available)
  const fetchPools = useCallback(async (isBackgroundRefresh = false) => {
    // Prevent concurrent fetches
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;

    try {
      if (!isBackgroundRefresh) {
        setError(null);
      }
      const response = await fetchPoolsMetrics(networkMode);

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch pools data');
      }

      const poolsMap = new Map<string, PoolData>();
      for (const pool of response.pools) {
        poolsMap.set(pool.poolId.toLowerCase(), toPoolData(pool));
      }

      setRestPools(poolsMap);
      setCachedPools(poolsMap, networkMode); // Update cache
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('[useWSPools] Failed to fetch pools:', err);
      if (!isBackgroundRefresh) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      setIsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [networkMode]);

  // Initial fetch (REST) - use cache if available
  useEffect(() => {
    // If WebSocket already has data, skip REST fetch
    if (ws?.pools && ws.pools.size > 0) {
      setIsLoading(false);
      return;
    }

    // Check cache
    const cached = getCachedPools(networkMode);
    if (cached) {
      setRestPools(cached.pools);
      setIsLoading(false);

      // If cache is stale, refresh in background
      if (cached.isStale) {
        fetchPools(true);
      }
      return;
    }

    // No cache, fetch fresh
    fetchPools();
  }, [fetchPools, ws?.pools, networkMode]);

  // Polling fallback when WebSocket disconnected
  useEffect(() => {
    if (isConnected) return;

    const intervalId = setInterval(() => {
      fetchPools(true); // Background refresh
    }, 45000); // 45s polling when WS disconnected

    return () => clearInterval(intervalId);
  }, [isConnected, fetchPools]);

  // Merge WebSocket data with REST data (WS takes precedence)
  const poolsMap = useMemo((): Map<string, PoolData> => {
    const merged = new Map<string, PoolData>();

    // Start with REST data
    restPools.forEach((pool, key) => {
      merged.set(key, pool);
    });

    // Override with WebSocket data (more recent)
    if (ws?.pools) {
      ws.pools.forEach((wsPool, key) => {
        merged.set(key, {
          poolId: wsPool.poolId,
          name: wsPool.name,
          network: wsPool.network,
          tvlUsd: wsPool.tvlUsd,
          volume24hUsd: wsPool.volume24hUsd,
          fees24hUsd: wsPool.fees24hUsd,
          lpFee: wsPool.lpFee,
          token0Price: wsPool.token0Price,
          token1Price: wsPool.token1Price,
          apr24h: calculateApr(wsPool.fees24hUsd, wsPool.tvlUsd),
          lastUpdated: wsPool.timestamp,
        });
      });
    }

    // Update cache with merged data
    if (merged.size > 0) {
      setCachedPools(merged, networkMode);
    }

    return merged;
  }, [ws?.pools, restPools, networkMode]);

  // Convert map to array for convenience
  const pools = useMemo(() => Array.from(poolsMap.values()), [poolsMap]);

  // Update lastUpdated when data changes
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
