"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import type { V4ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";
import { isUnifiedYieldPositionId } from "@/lib/liquidity/unified-yield/types";
import { fetchUnifiedYieldPositions } from "@/lib/liquidity/unified-yield/fetchUnifiedYieldPositions";

/**
 * Position union type for this hook - combines V4 and Unified Yield positions
 * Each position type is fetched through its own dedicated flow for clean separation
 */
type Position = V4ProcessedPosition | UnifiedYieldPosition;
import { createNetworkClient } from "@/lib/viemClient";
import { useNetwork } from "@/lib/network-context";
import {
  loadUserPositionIds,
  derivePositionsFromIds,
  getCachedPositionTimestamps,
  removePositionIdFromCache,
} from "@/lib/client-cache";
import { invalidateAfterTx } from "@/lib/apollo/mutations";

interface UsePoolPositionsOptions {
  poolId: string;
  subgraphId: string;
}

interface UsePoolPositionsReturn {
  userPositions: Position[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;
  refreshPositions: () => Promise<void>;
  refreshAfterLiquidityAdded: (options?: RefreshOptions) => Promise<void>;
  refreshAfterMutation: (info?: MutationInfo) => Promise<void>;
  updatePositionOptimistically: (positionId: string, updates: Partial<V4ProcessedPosition>) => void;
  removePositionOptimistically: (positionId: string) => void;
  clearOptimisticFees: (positionId: string) => void;
  clearAllOptimisticStates: () => void;
}

interface RefreshOptions {
  token0Symbol?: string;
  token1Symbol?: string;
  txInfo?: {
    txHash?: `0x${string}`;
    blockNumber?: bigint;
    tvlDelta?: number;
    volumeDelta?: number;
  };
}

interface MutationInfo {
  txHash?: `0x${string}`;
  tvlDelta?: number;
}

export function usePoolPositions({
  poolId,
  subgraphId,
}: UsePoolPositionsOptions): UsePoolPositionsReturn {
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const { networkMode } = useNetwork();

  const [userPositions, setUserPositions] = useState<Position[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(true);
  const [isDerivingNewPosition, setIsDerivingNewPosition] = useState(false);
  const [optimisticallyClearedFees, setOptimisticallyClearedFees] = useState<Set<string>>(new Set());

  const refreshThrottleRef = useRef(0);

  // Filter positions to this pool (works for both V4 and Unified Yield)
  const filterPositionsForPool = useCallback((positions: Position[]) => {
    const subgraphIdLc = (subgraphId || '').toLowerCase();
    return positions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphIdLc);
  }, [subgraphId]);

  // Fetch all positions (V4 from on-chain, UY from Hook contracts)
  const fetchAllPositions = useCallback(async (ids: string[]): Promise<Position[]> => {
    if (!accountAddress || !chainId) return [];

    // Separate V4 and Unified Yield IDs
    const v4Ids = ids.filter(id => !isUnifiedYieldPositionId(id));

    // Fetch V4 positions from on-chain
    const timestamps = getCachedPositionTimestamps(accountAddress);
    const v4Positions = v4Ids.length > 0
      ? await derivePositionsFromIds(accountAddress, v4Ids, chainId, timestamps)
      : [];

    // Fetch Unified Yield positions from Hook contracts
    let uyPositions: Position[] = [];
    try {
      const client = createNetworkClient(networkMode);
      const fetchedUY = await fetchUnifiedYieldPositions({
        userAddress: accountAddress as `0x${string}`,
        chainId,
        networkMode,
        client,
      });
      uyPositions = fetchedUY;
    } catch (error) {
      console.warn('[usePoolPositions] Failed to fetch Unified Yield positions:', error);
    }

    return [...v4Positions, ...uyPositions];
  }, [accountAddress, chainId, networkMode]);

  // Load user positions
  const refreshPositions = useCallback(async () => {
    if (!poolId || !isConnected || !accountAddress || !chainId) {
      if (!isConnected) {
        setUserPositions([]);
        setIsLoadingPositions(false);
      }
      return;
    }

    setIsLoadingPositions(true);
    try {
      const ids = await loadUserPositionIds(accountAddress, {
        onRefreshed: async (freshIds) => {
          const allPositions = await fetchAllPositions(freshIds);
          setUserPositions(filterPositionsForPool(allPositions));
        },
      });
      const allPositions = await fetchAllPositions(ids);
      setUserPositions(filterPositionsForPool(allPositions));
    } catch (error) {
      console.error('[usePoolPositions] Failed to load positions:', error);
      setUserPositions([]);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, chainId, filterPositionsForPool, fetchAllPositions]);

  // Refresh after liquidity added - with skeleton for new position
  const refreshAfterLiquidityAdded = useCallback(async (options?: RefreshOptions) => {
    const now = Date.now();
    const timeSinceLastCall = now - refreshThrottleRef.current;
    if (refreshThrottleRef.current && timeSinceLastCall < 2000) return;
    refreshThrottleRef.current = now;

    if (!accountAddress || !poolId || !chainId) return;

    setIsDerivingNewPosition(true);
    try {
      const ids = await loadUserPositionIds(accountAddress);
      const allDerived = await fetchAllPositions(ids);
      const filtered = filterPositionsForPool(allDerived);

      setUserPositions(prev => {
        const existingIds = new Set(prev.map(p => p.positionId));
        const newPositions = filtered.filter(p => !existingIds.has(p.positionId));
        const updated = prev.map(p => {
          const fresh = filtered.find(f => f.positionId === p.positionId);
          if (!fresh) return p;
          // Only V4 positions have optimistic update flags
          if (fresh.type === 'v4') {
            return { ...fresh, isOptimisticallyUpdating: undefined };
          }
          return fresh;
        });
        return [...newPositions, ...updated];
      });

      await invalidateAfterTx(null, {
        owner: accountAddress,
        chainId,
        poolId,
        optimisticUpdates: options?.txInfo?.tvlDelta ? { tvlDelta: options.txInfo.tvlDelta } : undefined,
      }).catch(() => {});
    } catch (error) {
      console.error('[refreshAfterLiquidityAdded] Failed:', error);
    } finally {
      setIsDerivingNewPosition(false);
    }
  }, [accountAddress, poolId, chainId, filterPositionsForPool, fetchAllPositions]);

  // Refresh after mutation (decrease/burn)
  const refreshAfterMutation = useCallback(async (info?: MutationInfo) => {
    if (!poolId || !isConnected || !accountAddress || !chainId) return;

    await invalidateAfterTx(null, {
      owner: accountAddress,
      chainId,
      poolId,
      optimisticUpdates: info?.tvlDelta ? { tvlDelta: info.tvlDelta } : undefined,
      clearOptimisticStates: () => {
        setUserPositions(prev => prev.map(p => {
          if (p.type === 'v4') {
            return { ...p, isOptimisticallyUpdating: undefined };
          }
          return p;
        }));
        setOptimisticallyClearedFees(new Set());
      },
    });
  }, [poolId, isConnected, accountAddress, chainId]);

  // Update a position optimistically (V4 positions only)
  const updatePositionOptimistically = useCallback((positionId: string, updates: Partial<V4ProcessedPosition>) => {
    setUserPositions(prev => prev.map(p => {
      if (p.positionId === positionId && p.type === 'v4') {
        return { ...p, ...updates };
      }
      return p;
    }));
  }, []);

  // Remove a position optimistically (full burn)
  const removePositionOptimistically = useCallback((positionId: string) => {
    setUserPositions(prev => prev.filter(p => p.positionId !== positionId));
    if (accountAddress) {
      removePositionIdFromCache(accountAddress, positionId);
    }
  }, [accountAddress]);

  // Clear fees optimistically for a position
  const clearOptimisticFees = useCallback((positionId: string) => {
    setOptimisticallyClearedFees(prev => new Set(prev).add(positionId));
  }, []);

  // Clear all optimistic states (V4 positions only have these flags)
  const clearAllOptimisticStates = useCallback(() => {
    setUserPositions(prev => prev.map(p => {
      if (p.type === 'v4') {
        return { ...p, isOptimisticallyUpdating: undefined };
      }
      return p;
    }));
    setOptimisticallyClearedFees(new Set());
  }, []);

  // Load positions on mount and when wallet connects
  useEffect(() => {
    refreshPositions();
  }, [refreshPositions]);

  return {
    userPositions,
    isLoadingPositions,
    isDerivingNewPosition,
    optimisticallyClearedFees,
    refreshPositions,
    refreshAfterLiquidityAdded,
    refreshAfterMutation,
    updatePositionOptimistically,
    removePositionOptimistically,
    clearOptimisticFees,
    clearAllOptimisticStates,
  };
}
