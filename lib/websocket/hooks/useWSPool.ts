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
 *       <p>APY: {pool?.apy24h.toFixed(2)}%</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocketOptional } from '../WebSocketProvider';
import { fetchPoolsMetrics, type PoolMetrics } from '../../backend-client';
import { parseNetworkMode, type NetworkMode } from '../../network-mode';
import { ALL_MODES } from '../../chain-registry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pool data with calculated APR
 */
export interface PoolData {
  poolId: string;
  name: string;
  /** Raw backend network string (e.g. 'base', 'arbitrum') */
  network: string;
  /** Resolved NetworkMode for frontend use */
  networkMode: NetworkMode;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  /** 24h lending yield in USD (from Aave/Spark for UY pools) */
  lendingYield24hUsd?: number;
  /** 24h total fees in USD (swap fees + lending yield) */
  totalFees24hUsd?: number;
  lpFee: number;
  /** USD value of token0 reserves (CL + UY combined) */
  tvlToken0Usd?: number;
  /** USD value of token1 reserves (CL + UY combined) */
  tvlToken1Usd?: number;
  /** Total lifetime fees earned by LPs in this pool */
  cumulativeFeesUsd?: number;
  token0Price: number;
  token1Price: number;
  /** Swap APY from backend (compound daily) */
  swapApy?: number;
  /** Lending APY from backend (weighted, with yield factor) */
  lendingApy?: number;
  /** Total APY from backend (swap + lending) */
  totalApy?: number;
  /** Fallback: frontend-calculated swap APY from fees24h/tvl */
  apy24h: number;
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
 * Calculate annualized APY from 24h fees and TVL (compound daily)
 */
function calculateApy(fees24hUsd: number, tvlUsd: number): number {
  if (tvlUsd <= 0) return 0;
  const dailyRate = fees24hUsd / tvlUsd;
  return ((1 + dailyRate) ** 365 - 1) * 100;
}

/**
 * Convert PoolMetrics to PoolData with calculated APR
 */
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

export function useWSPool(poolId: string, networkModeOverride?: NetworkMode): UseWSPoolReturn {
  const effectiveNetworkMode = networkModeOverride ?? 'base' as NetworkMode;
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
      // Fetch from the specified chain first, then try all chains as fallback
      const modesToTry = [effectiveNetworkMode, ...ALL_MODES.filter(m => m !== effectiveNetworkMode)];

      let foundPool: PoolMetrics | null = null;
      for (const mode of modesToTry) {
        const response = await fetchPoolsMetrics(mode);
        if (response.success && response.pools) {
          const match = response.pools.find(p => p.poolId.toLowerCase() === poolId.toLowerCase());
          if (match) {
            foundPool = match;
            break;
          }
        }
      }

      if (!foundPool) {
        throw new Error('Pool not found');
      }

      setRestPool(toPoolData(foundPool));
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('[useWSPool] Failed to fetch pool:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [poolId, effectiveNetworkMode]);

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
