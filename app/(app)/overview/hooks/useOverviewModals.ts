"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { getAllPools, getToken } from "@/lib/pools-config";
import { prefetchService } from "@/lib/prefetch-service";
import { invalidateAfterTx } from "@/lib/apollo";
import { useIncreaseLiquidity, useDecreaseLiquidity } from "@/lib/liquidity/hooks";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { usePublicClient } from "wagmi";
import { markPositionAsRemoved } from "./useOverviewData";
import type { PublicClient } from "viem";

// Badge icon component for toast (simplified)
const BadgeCheckIcon = () => null; // Rendered inline in page.tsx

interface OverviewModalsConfig {
  accountAddress?: `0x${string}`;
  activePositions: any[];
  setActivePositions: React.Dispatch<React.SetStateAction<any[]>>;
  setPositionsRefresh: React.Dispatch<React.SetStateAction<number>>;
  refreshSinglePosition: (positionId: string) => Promise<void>;
}

interface ModalCallbackInfo {
  txHash?: `0x${string}`;
  blockNumber?: bigint;
  isFullBurn?: boolean;
  increaseAmounts?: { amount0: string; amount1: string };
  positionId?: string;
}

export function useOverviewModals({
  accountAddress,
  activePositions,
  setActivePositions,
  setPositionsRefresh,
  refreshSinglePosition,
}: OverviewModalsConfig) {
  const publicClient = usePublicClient();

  // Modal state
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<any | null>(null);
  const [positionToWithdraw, setPositionToWithdraw] = useState<any | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<any | null>(null);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);

  // Refs for tracking
  const modifiedPositionPoolInfoRef = useRef<{ poolId: string; subgraphId: string } | null>(null);
  const pendingActionRef = useRef<null | { type: 'increase' | 'decrease' | 'withdraw' | 'collect' }>(null);
  const lastRevalidationRef = useRef<number>(0);
  const handledIncreaseHashRef = useRef<string | null>(null);
  const handledDecreaseHashRef = useRef<string | null>(null);
  const lastDecreaseWasFullRef = useRef<boolean>(false);
  const lastTxBlockRef = useRef<bigint | null>(null);

  // Refresh after mutation - simplified to 2-layer pattern
  const refreshAfterMutation = useCallback(async (opts: {
    txHash?: `0x${string}`;
    poolId?: string;
    tvlDelta?: number;
    volumeDelta?: number;
    chainId?: number;
  }) => {
    if (!accountAddress) return;
    const { poolId, chainId = 84532, tvlDelta, volumeDelta } = opts;
    try {
      await invalidateAfterTx(null, {
        owner: accountAddress,
        chainId,
        poolId,
        optimisticUpdates: (tvlDelta !== undefined || volumeDelta !== undefined) ? {
          tvlDelta,
          volumeDelta,
        } : undefined,
        clearOptimisticStates: () => {
          setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
        }
      });
      // Notify after invalidation completes (moved from dead callback)
      prefetchService.notifyPositionsRefresh(accountAddress, 'manual_refresh');
      setPositionsRefresh(k => k + 1);
    } catch (error) {
      console.error('[Portfolio refreshAfterMutation] failed:', error);
      setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
    }
  }, [accountAddress, setActivePositions, setPositionsRefresh]);

  const bumpPositionsRefresh = useCallback(() => {
    try {
      if (accountAddress) prefetchService.notifyPositionsRefresh(accountAddress, 'manual_refresh');
    } catch {}
    setPositionsRefresh((k) => k + 1);
  }, [accountAddress, setPositionsRefresh]);

  // Liquidity increased callback
  const onLiquidityIncreasedCallback = useCallback(async (info?: ModalCallbackInfo) => {
    if (!info?.txHash) return;
    if (handledIncreaseHashRef.current === info.txHash) return;
    handledIncreaseHashRef.current = info.txHash;
    if (pendingActionRef.current?.type !== 'increase') return;
    const now = Date.now();
    if (now - lastRevalidationRef.current < 15000) return;
    lastRevalidationRef.current = now;

    const targetPositionId = info?.positionId || positionToModify?.positionId;
    if (targetPositionId && info?.increaseAmounts) {
      setActivePositions(prev => prev.map(p => {
        if (p.positionId === targetPositionId) {
          const currentAmount0 = parseFloat(p.token0.amount || '0');
          const currentAmount1 = parseFloat(p.token1.amount || '0');
          const addedAmount0 = parseFloat(info.increaseAmounts!.amount0 || '0');
          const addedAmount1 = parseFloat(info.increaseAmounts!.amount1 || '0');

          return {
            ...p,
            token0: { ...p.token0, amount: (currentAmount0 + addedAmount0).toString() },
            token1: { ...p.token1, amount: (currentAmount1 + addedAmount1).toString() },
            isOptimisticallyUpdating: true
          };
        }
        return p;
      }));
    } else if (targetPositionId) {
      setActivePositions(prev => prev.map(p =>
        p.positionId === targetPositionId
          ? { ...p, isOptimisticallyUpdating: true }
          : p
      ));

      setTimeout(() => {
        setActivePositions(prev => prev.map(p =>
          p.positionId === targetPositionId
            ? { ...p, isOptimisticallyUpdating: undefined }
            : p
        ));
      }, 30000);
    }

    if (positionToModify?.poolId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === positionToModify.poolId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: positionToModify.poolId };
      }
    }

    setShowIncreaseModal(false);
    pendingActionRef.current = null;

    if (targetPositionId) {
      refreshSinglePosition(targetPositionId).catch(console.error);
    } else {
      bumpPositionsRefresh();
    }

    if (modifiedPositionPoolInfoRef.current) {
      const { poolId } = modifiedPositionPoolInfoRef.current;
      refreshAfterMutation({ txHash: info.txHash, poolId }).catch(console.error);
      modifiedPositionPoolInfoRef.current = null;
    }
  }, [refreshSinglePosition, refreshAfterMutation, bumpPositionsRefresh, positionToModify, setActivePositions]);

  // Liquidity decreased callback
  const onLiquidityDecreasedCallback = useCallback(async (info?: ModalCallbackInfo) => {
    if (!info?.txHash) return;
    if (handledDecreaseHashRef.current === info.txHash) return;
    handledDecreaseHashRef.current = info.txHash;
    if (pendingActionRef.current?.type !== 'decrease' && pendingActionRef.current?.type !== 'withdraw') return;

    const closing = info?.isFullBurn ?? !!lastDecreaseWasFullRef.current;
    const targetPositionId = positionToWithdraw?.positionId;

    if (targetPositionId) {
      if (closing) {
        markPositionAsRemoved(targetPositionId);
        setActivePositions(prev => prev.filter(p => p.positionId !== targetPositionId));
      } else {
        setActivePositions(prev => prev.map(p =>
          p.positionId === targetPositionId
            ? { ...p, isOptimisticallyUpdating: true }
            : p
        ));

        setTimeout(() => {
          setActivePositions(prev => prev.map(p =>
            p.positionId === targetPositionId
              ? { ...p, isOptimisticallyUpdating: undefined }
              : p
          ));
        }, 30000);
      }
    }

    if (positionToWithdraw?.poolId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === positionToWithdraw.poolId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: positionToWithdraw.poolId };
      }
    }

    setShowWithdrawModal(false);
    setPositionToWithdraw(null);
    pendingActionRef.current = null;

    const now = Date.now();
    if (now - lastRevalidationRef.current >= 15000) {
      lastRevalidationRef.current = now;

      const poolIdForInvalidation = modifiedPositionPoolInfoRef.current?.poolId;

      if (targetPositionId) {
        if (closing) {
          bumpPositionsRefresh();
        } else {
          refreshSinglePosition(targetPositionId).catch(console.error);
        }
      } else {
        refreshAfterMutation({ txHash: info?.txHash, poolId: poolIdForInvalidation }).catch(console.error);
      }

      if (poolIdForInvalidation) {
        refreshAfterMutation({ txHash: info?.txHash, poolId: poolIdForInvalidation }).catch(console.error);
      }

      modifiedPositionPoolInfoRef.current = null;
    }
  }, [refreshAfterMutation, refreshSinglePosition, bumpPositionsRefresh, positionToWithdraw, setActivePositions]);

  // Fees collected callback - uses 2-layer invalidation pattern
  const onFeesCollected = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint; positionId?: string }) => {
    if (!accountAddress) return;
    lastTxBlockRef.current = null;
    // Use invalidateAfterTx with clearFees optimistic update
    await invalidateAfterTx(null, {
      owner: accountAddress,
      chainId: 84532,
      optimisticUpdates: info?.positionId ? { clearFees: { positionId: info.positionId } } : undefined,
    });
  }, [accountAddress]);

  const handleModalFeesCollected = useCallback(async (positionId: string) => {
    if (!accountAddress) return;
    await invalidateAfterTx(null, {
      owner: accountAddress,
      chainId: 84532,
      optimisticUpdates: { clearFees: { positionId } },
    });
  }, [accountAddress]);

  // Sync selectedPosition with activePositions
  useEffect(() => {
    if (!selectedPosition || activePositions.length === 0) return;
    const updatedPosition = activePositions.find(p => p.positionId === selectedPosition.positionId);
    if (!updatedPosition) return;

    const hasChanged =
      updatedPosition.token0?.amount !== selectedPosition.token0?.amount ||
      updatedPosition.token1?.amount !== selectedPosition.token1?.amount ||
      updatedPosition.liquidityRaw !== selectedPosition.liquidityRaw;

    if (hasChanged) setSelectedPosition(updatedPosition);
  }, [activePositions, selectedPosition]);

  // Subscribe to centralized refresh events
  useEffect(() => {
    if (!accountAddress) return;
    const unsubscribe = prefetchService.addPositionsListener(accountAddress, () => {
      setPositionsRefresh((k) => k + 1);
    });
    return unsubscribe;
  }, [accountAddress, setPositionsRefresh]);

  // Use the liquidity hooks
  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess: isIncreaseSuccess, hash: increaseTxHash } = useIncreaseLiquidity({
    onLiquidityIncreased: onLiquidityIncreasedCallback
  });

  const { decreaseLiquidity, claimFees, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash } = useDecreaseLiquidity({
    onLiquidityDecreased: onLiquidityDecreasedCallback,
    onFeesCollected
  });

  // Clear optimistic loading state when hook finishes
  useEffect(() => {
    if (!isDecreasingLiquidity && pendingActionRef.current?.type === 'collect') {
      setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
      pendingActionRef.current = null;
    }
  }, [isDecreasingLiquidity, setActivePositions]);

  // Modal handlers
  const openIncreaseModal = useCallback((position: any) => {
    setPositionToModify(position);
    setShowIncreaseModal(true);
  }, []);

  const closeIncreaseModal = useCallback(() => {
    setShowIncreaseModal(false);
    setPositionToModify(null);
  }, []);

  const openWithdrawModal = useCallback((position: any) => {
    setPositionToWithdraw(position);
    setShowWithdrawModal(true);
  }, []);

  const closeWithdrawModal = useCallback(() => {
    setShowWithdrawModal(false);
    setPositionToWithdraw(null);
  }, []);

  const openPositionModal = useCallback((position: any) => {
    setSelectedPosition(position);
    setIsPositionModalOpen(true);
  }, []);

  const closePositionModal = useCallback(() => {
    setIsPositionModalOpen(false);
    setSelectedPosition(null);
  }, []);

  const onIncreaseSuccess = useCallback(() => {
    const poolSubgraphId = positionToModify?.poolId;
    if (poolSubgraphId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
      }
    }
    publicClient?.getBlockNumber().then(block => lastTxBlockRef.current = block);
    pendingActionRef.current = { type: 'increase' };
  }, [positionToModify, publicClient]);

  const onDecreaseSuccess = useCallback(() => {
    const poolSubgraphId = positionToWithdraw?.poolId;
    if (poolSubgraphId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
      }
    }
    publicClient?.getBlockNumber().then(block => lastTxBlockRef.current = block);
    pendingActionRef.current = { type: 'decrease' };
  }, [positionToWithdraw, publicClient]);

  return {
    // Modal state
    showIncreaseModal,
    showWithdrawModal,
    positionToModify,
    positionToWithdraw,
    selectedPosition,
    isPositionModalOpen,

    // Modal handlers
    openIncreaseModal,
    closeIncreaseModal,
    openWithdrawModal,
    closeWithdrawModal,
    openPositionModal,
    closePositionModal,
    setPositionToWithdraw,

    // Success handlers
    onIncreaseSuccess,
    onDecreaseSuccess,
    handleModalFeesCollected,
    onLiquidityDecreasedCallback,

    // Liquidity hooks
    increaseLiquidity,
    decreaseLiquidity,
    claimFees,
    isIncreasingLiquidity,
    isDecreasingLiquidity,

    // Refresh utilities
    refreshAfterMutation,
    bumpPositionsRefresh,

    // Refs
    pendingActionRef,
    lastTxBlockRef,
  };
}
