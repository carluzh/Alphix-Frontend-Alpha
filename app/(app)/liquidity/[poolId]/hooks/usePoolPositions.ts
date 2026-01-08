"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
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
  userPositions: ProcessedPosition[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;
  refreshPositions: () => Promise<void>;
  refreshAfterLiquidityAdded: (options?: RefreshOptions) => Promise<void>;
  refreshAfterMutation: (info?: MutationInfo) => Promise<void>;
  updatePositionOptimistically: (positionId: string, updates: Partial<ProcessedPosition>) => void;
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

  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(true);
  const [isDerivingNewPosition, setIsDerivingNewPosition] = useState(false);
  const [optimisticallyClearedFees, setOptimisticallyClearedFees] = useState<Set<string>>(new Set());

  const refreshThrottleRef = useRef(0);

  // Filter positions to this pool
  const filterPositionsForPool = useCallback((positions: ProcessedPosition[]) => {
    const subgraphIdLc = (subgraphId || '').toLowerCase();
    return positions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphIdLc);
  }, [subgraphId]);

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
          const timestamps = getCachedPositionTimestamps(accountAddress);
          const allPositions = await derivePositionsFromIds(accountAddress, freshIds, chainId, timestamps);
          setUserPositions(filterPositionsForPool(allPositions));
        },
      });
      const timestamps = getCachedPositionTimestamps(accountAddress);
      const allPositions = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
      setUserPositions(filterPositionsForPool(allPositions));
    } catch (error) {
      console.error('[usePoolPositions] Failed to load positions:', error);
      setUserPositions([]);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, chainId, filterPositionsForPool]);

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
      const timestamps = getCachedPositionTimestamps(accountAddress);
      const allDerived = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
      const filtered = filterPositionsForPool(allDerived);

      setUserPositions(prev => {
        const existingIds = new Set(prev.map(p => p.positionId));
        const newPositions = filtered.filter(p => !existingIds.has(p.positionId));
        const updated = prev.map(p => {
          const fresh = filtered.find(f => f.positionId === p.positionId);
          return fresh ? { ...fresh, isOptimisticallyUpdating: undefined } : p;
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
  }, [accountAddress, poolId, chainId, filterPositionsForPool]);

  // Refresh after mutation (decrease/burn)
  const refreshAfterMutation = useCallback(async (info?: MutationInfo) => {
    if (!poolId || !isConnected || !accountAddress || !chainId) return;

    await invalidateAfterTx(null, {
      owner: accountAddress,
      chainId,
      poolId,
      optimisticUpdates: info?.tvlDelta ? { tvlDelta: info.tvlDelta } : undefined,
      clearOptimisticStates: () => {
        setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
        setOptimisticallyClearedFees(new Set());
      },
    });
  }, [poolId, isConnected, accountAddress, chainId]);

  // Update a position optimistically
  const updatePositionOptimistically = useCallback((positionId: string, updates: Partial<ProcessedPosition>) => {
    setUserPositions(prev => prev.map(p =>
      p.positionId === positionId ? { ...p, ...updates } : p
    ));
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

  // Clear all optimistic states
  const clearAllOptimisticStates = useCallback(() => {
    setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
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
