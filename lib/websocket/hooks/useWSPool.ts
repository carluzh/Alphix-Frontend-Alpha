'use client';

/**
 * useWSPool Hook
 *
 * Hook for accessing a single pool's metrics from the WebSocket pools:metrics channel.
 * Pattern: Initial REST load from api.alphix.fi → WebSocket real-time updates.
 *
 * Usage:
 * ```tsx
 * function PoolDetail({ poolId }) {
 *   const { pool, isConnected, isLoading } = useWSPool(poolId);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       <h1>TVL: ${pool?.tvlUsd.toLocaleString()}</h1>
 *       <p>24h Volume: ${pool?.volume24hUsd.toLocaleString()}</p>
 *       <p>APR: {pool?.apr24h.toFixed(2)}%</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
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

interface UseWSPoolReturn {
  /** Pool data */
  pool: PoolData | null;
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

export function useWSPool(poolId: string): UseWSPoolReturn {
  const { networkMode } = useNetwork();
  const ws = useWebSocketOptional();

  // Local state for REST fallback
  const [restPool, setRestPool] = useState<PoolData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const isConnected = ws?.isConnected ?? false;

  // Fetch from REST (fallback when WS not available or for initial load)
  const fetchPool = useCallback(async () => {
    if (!poolId) {
      setRestPool(null);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      // Fetch all pools and filter (backend only has /pools/metrics, not /pools/{id}/metrics)
      const response = await fetchPoolsMetrics(networkMode);

      if (!response.success || !response.pools) {
        throw new Error(response.error || 'Failed to fetch pool data');
      }

      const pool = response.pools.find(p => p.poolId.toLowerCase() === poolId.toLowerCase());
      if (!pool) {
        throw new Error('Pool not found');
      }

      setRestPool(toPoolData(pool));
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('[useWSPool] Failed to fetch pool:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [poolId, networkMode]);

  // Initial fetch (REST fallback)
  useEffect(() => {
    // Only fetch from REST if WebSocket data not available yet
    if (!ws?.pools.has(poolId?.toLowerCase())) {
      fetchPool();
    } else {
      setIsLoading(false);
    }
  }, [fetchPool, poolId, ws?.pools]);

  // Polling fallback when WebSocket disconnected
  useEffect(() => {
    if (isConnected || !poolId) return;

    const intervalId = setInterval(() => {
      fetchPool();
    }, 45000); // 45s polling when WS disconnected

    return () => clearInterval(intervalId);
  }, [isConnected, poolId, fetchPool]);

  // Get pool from WebSocket data (takes precedence over REST)
  const pool = useMemo((): PoolData | null => {
    const poolIdLower = poolId?.toLowerCase();
    if (!poolIdLower) return null;

    // Try WebSocket data first
    const wsPool = ws?.pools.get(poolIdLower);
    if (wsPool) {
      return {
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
      };
    }

    // Fall back to REST data
    return restPool;
  }, [ws?.pools, poolId, restPool]);

  // Update lastUpdated when pool changes
  useEffect(() => {
    if (pool?.lastUpdated) {
      setLastUpdated(pool.lastUpdated);
    }
  }, [pool?.lastUpdated]);

  return {
    pool,
    isLoading,
    error,
    isConnected,
    refresh: fetchPool,
    lastUpdated,
  };
}
