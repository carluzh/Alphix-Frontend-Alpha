"use client";

import { memo, useState, useCallback, useEffect, useRef, useMemo, Suspense } from "react";
import React from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconBadgeCheck2 } from "nucleo-micro-bold-essential";
import { Sparkles, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { createLazy } from "@/lib/lazyWithRetry";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useIncreaseLiquidity, useDecreaseLiquidity } from "@/lib/liquidity/hooks";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";

import { PoolDetailHeader } from "./PoolDetailHeader";
import { PoolDetailStats } from "./PoolDetailStats";
import { PoolDetailPositions } from "./PoolDetailPositions";
import { ChartSection } from "../ChartSection";
import type {
  PoolConfig,
  PoolStats,
  PoolStateData,
  ChartDataPoint,
} from "../../hooks";

// Lazy load heavy modals
const IncreaseLiquidityModal = createLazy(() =>
  import("@/components/liquidity/increase").then((m) => ({ default: m.IncreaseLiquidityModal }))
);
const DecreaseLiquidityModal = createLazy(() =>
  import("@/components/liquidity/decrease").then((m) => ({ default: m.DecreaseLiquidityModal }))
);
const PositionDetailsModal = createLazy(() =>
  import("@/components/liquidity/PositionDetailsModal").then((m) => ({
    default: m.PositionDetailsModal,
  }))
);

export interface PoolDetailProps {
  // Pool data
  poolConfig: PoolConfig | null;
  poolStats: PoolStats;
  poolState: PoolStateData;

  // Chart data
  chartData: ChartDataPoint[];
  isLoadingChartData: boolean;

  // Positions
  userPositions: ProcessedPosition[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;

  // Prices
  priceMap: Record<string, number>;
  isLoadingPrices: boolean;

  // Denomination
  effectiveDenominationBase: string;
  denominationBaseOverride: string | null;
  handleDenominationToggle: (newBase: string) => void;

  // Token definitions
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>;

  // Tick utilities
  sdkMinTick: number;
  sdkMaxTick: number;
  convertTickToPrice: (
    tick: number,
    currentPoolTick: number | null,
    currentPrice: string | null,
    baseTokenForPriceDisplay: string,
    token0Symbol: string,
    token1Symbol: string
  ) => string;

  // Callbacks
  refreshPositions: () => Promise<void>;
  refreshAfterLiquidityAdded: (options?: {
    token0Symbol?: string;
    token1Symbol?: string;
    txInfo?: { txHash?: `0x${string}`; blockNumber?: bigint; tvlDelta?: number; volumeDelta?: number };
  }) => Promise<void>;
  refreshAfterMutation: (info?: { txHash?: `0x${string}`; tvlDelta?: number }) => Promise<void>;
  updatePositionOptimistically: (positionId: string, updates: Partial<ProcessedPosition>) => void;
  removePositionOptimistically: (positionId: string) => void;
  clearOptimisticFees: (positionId: string) => void;
  clearAllOptimisticStates: () => void;

  // USD calculations
  getUsdPriceForSymbol: (symbol?: string) => number;
  calculatePositionUsd: (position: ProcessedPosition) => number;
}

/**
 * Main Pool Detail component.
 * Receives all data as props and manages only local UI state.
 */
export const PoolDetail = memo(function PoolDetail({
  poolConfig,
  poolStats,
  poolState,
  chartData,
  isLoadingChartData,
  userPositions,
  isLoadingPositions,
  isDerivingNewPosition,
  optimisticallyClearedFees,
  priceMap,
  isLoadingPrices,
  effectiveDenominationBase,
  denominationBaseOverride,
  handleDenominationToggle,
  tokenDefinitions,
  sdkMinTick,
  sdkMaxTick,
  convertTickToPrice,
  refreshPositions,
  refreshAfterLiquidityAdded,
  refreshAfterMutation,
  updatePositionOptimistically,
  removePositionOptimistically,
  clearOptimisticFees,
  clearAllOptimisticStates,
  getUsdPriceForSymbol,
  calculatePositionUsd,
}: PoolDetailProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { address: accountAddress, chainId } = useAccount();

  // Window width for responsive chart
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== "undefined") {
      setWindowWidth(window.innerWidth);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // =========================================================================
  // LOCAL UI STATE (modals, selections)
  // =========================================================================
  const [selectedPositionForDetails, setSelectedPositionForDetails] = useState<ProcessedPosition | null>(null);
  const [isPositionDetailsModalOpen, setIsPositionDetailsModalOpen] = useState(false);
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showDecreaseModal, setShowDecreaseModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<ProcessedPosition | null>(null);

  // Guard refs for preventing duplicate handlers
  const pendingActionRef = useRef<null | { type: "increase" | "decrease" | "withdraw" | "burn" | "collect" | "compound" }>(null);
  const handledIncreaseHashRef = useRef<string | null>(null);
  const handledDecreaseHashRef = useRef<string | null>(null);

  // =========================================================================
  // POSITION INFO CONVERSION
  // =========================================================================
  const getPositionInfo = useCallback(
    (position: ProcessedPosition, feeData?: { amount0?: string; amount1?: string }): PositionInfo | undefined => {
      const subgraphPos: SubgraphPosition = {
        positionId: position.positionId,
        owner: position.owner || "",
        poolId: position.poolId,
        token0: {
          address: position.token0?.address || "",
          symbol: position.token0?.symbol || "",
          amount: position.token0?.amount || "0",
        },
        token1: {
          address: position.token1?.address || "",
          symbol: position.token1?.symbol || "",
          amount: position.token1?.amount || "0",
        },
        tickLower: position.tickLower ?? 0,
        tickUpper: position.tickUpper ?? 0,
        liquidity: position.liquidityRaw || "0",
        isInRange: position.isInRange ?? true,
        token0UncollectedFees: feeData?.amount0,
        token1UncollectedFees: feeData?.amount1,
        blockTimestamp: position.blockTimestamp,
        lastTimestamp: position.lastTimestamp,
      };

      const token0Decimals = tokenDefinitions?.[position.token0?.symbol as TokenSymbol]?.decimals ?? 18;
      const token1Decimals = tokenDefinitions?.[position.token1?.symbol as TokenSymbol]?.decimals ?? 18;

      return parseSubgraphPosition(subgraphPos, {
        chainId: chainId ?? 8453,
        token0Decimals,
        token1Decimals,
      });
    },
    [chainId, tokenDefinitions]
  );

  // =========================================================================
  // FEE DATA EXTRACTION
  // =========================================================================
  const getFeesForPosition = useCallback(
    (positionId: string, position?: ProcessedPosition) => {
      if (!positionId) return null;

      // If optimistically cleared, return zero
      if (optimisticallyClearedFees.has(positionId)) {
        return {
          positionId,
          amount0: "0",
          amount1: "0",
          totalValueUSD: 0,
        };
      }

      // Use position's built-in fees
      if (position?.token0UncollectedFees !== undefined && position?.token1UncollectedFees !== undefined) {
        return {
          positionId,
          amount0: position.token0UncollectedFees,
          amount1: position.token1UncollectedFees,
        };
      }

      return null;
    },
    [optimisticallyClearedFees]
  );

  // =========================================================================
  // LIQUIDITY MODIFICATION CALLBACKS
  // =========================================================================
  const onLiquidityIncreasedCallback = useCallback(
    (info?: { txHash?: `0x${string}`; blockNumber?: bigint; increaseAmounts?: { amount0: string; amount1: string } }) => {
      if (!info?.txHash) return;
      if (handledIncreaseHashRef.current === info.txHash) return;
      handledIncreaseHashRef.current = info.txHash;

      if (pendingActionRef.current?.type !== "increase") return;

      // Optimistic update
      if (positionToModify && info?.increaseAmounts) {
        const currentAmount0 = parseFloat(positionToModify.token0.amount || "0");
        const currentAmount1 = parseFloat(positionToModify.token1.amount || "0");
        const addedAmount0 = parseFloat(info.increaseAmounts.amount0 || "0");
        const addedAmount1 = parseFloat(info.increaseAmounts.amount1 || "0");

        updatePositionOptimistically(positionToModify.positionId, {
          token0: { ...positionToModify.token0, amount: (currentAmount0 + addedAmount0).toString() },
          token1: { ...positionToModify.token1, amount: (currentAmount1 + addedAmount1).toString() },
          isOptimisticallyUpdating: true,
        });
        clearOptimisticFees(positionToModify.positionId);
      }

      refreshAfterMutation({ txHash: info.txHash });
      pendingActionRef.current = null;
    },
    [positionToModify, updatePositionOptimistically, clearOptimisticFees, refreshAfterMutation]
  );

  const onLiquidityDecreasedCallback = useCallback(
    (info?: { txHash?: `0x${string}`; blockNumber?: bigint; isFullBurn?: boolean }) => {
      if (!info?.txHash) return;
      if (handledDecreaseHashRef.current === info.txHash) return;
      handledDecreaseHashRef.current = info.txHash;

      const targetPosition = positionToModify || selectedPositionForDetails;
      const isPendingAction = pendingActionRef.current?.type === "decrease" || pendingActionRef.current?.type === "withdraw";
      if (!isPendingAction && !targetPosition) return;

      if (targetPosition) {
        if (info?.isFullBurn) {
          removePositionOptimistically(targetPosition.positionId);
        } else {
          updatePositionOptimistically(targetPosition.positionId, { isOptimisticallyUpdating: true });
          clearOptimisticFees(targetPosition.positionId);
        }
      }

      pendingActionRef.current = null;
      refreshAfterMutation(info);
    },
    [positionToModify, selectedPositionForDetails, updatePositionOptimistically, removePositionOptimistically, clearOptimisticFees, refreshAfterMutation]
  );

  // Initialize liquidity hooks
  const { increaseLiquidity, reset: resetIncreaseLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: onLiquidityIncreasedCallback,
  });

  const { decreaseLiquidity, reset: resetDecreaseLiquidity } = useDecreaseLiquidity({
    onLiquidityDecreased: onLiquidityDecreasedCallback,
    onFeesCollected: (info) => {
      toast.success("Fees Collected", {
        icon: <IconBadgeCheck2 className="h-4 w-4 text-green-500" />,
        description: "Fees successfully collected",
        action: info?.txHash
          ? {
              label: "View Transaction",
              onClick: () => window.open(getExplorerTxUrl(info.txHash!), "_blank"),
            }
          : undefined,
      });
    },
  });

  // Reset hooks when modals open
  useEffect(() => {
    if (showIncreaseModal) resetIncreaseLiquidity();
  }, [showIncreaseModal, resetIncreaseLiquidity]);

  useEffect(() => {
    if (showDecreaseModal) resetDecreaseLiquidity();
  }, [showDecreaseModal, resetDecreaseLiquidity]);

  // =========================================================================
  // HANDLERS
  // =========================================================================
  const handleAddLiquidity = useCallback(() => {
    // Navigate to the new wizard flow with pool pre-selected
    // This skips Token Selection and LP Option steps (pool already known)
    if (poolConfig?.id) {
      router.push(`/liquidity/add?pool=${poolConfig.id}&mode=rehypo&from=pool`);
    }
  }, [poolConfig?.id, router]);

  const handlePositionClick = useCallback((position: ProcessedPosition) => {
    setSelectedPositionForDetails(position);
    setIsPositionDetailsModalOpen(true);
  }, []);

  // =========================================================================
  // HELPERS
  // =========================================================================
  const formatTokenDisplayAmount = useCallback((amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0";
    if (num > 0 && num < 0.000001) return "< 0.000001";
    return num.toFixed(6);
  }, []);

  // =========================================================================
  // COMPUTED VALUES
  // =========================================================================
  const selectedPositionInfo = useMemo(() => {
    if (!selectedPositionForDetails) return null;
    const feeData = getFeesForPosition(selectedPositionForDetails.positionId, selectedPositionForDetails);
    return getPositionInfo(selectedPositionForDetails, feeData ?? undefined);
  }, [selectedPositionForDetails, getFeesForPosition, getPositionInfo]);

  const token0Symbol = poolConfig?.tokens?.[0]?.symbol || "";
  const token1Symbol = poolConfig?.tokens?.[1]?.symbol || "";

  // =========================================================================
  // RENDER
  // =========================================================================
  if (!poolConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Pool not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1400px] mx-auto pb-20 min-[1400px]:pb-6">
      {/* Two-column layout on desktop - matches Overview page ratios */}
      <div className="flex flex-col min-[1400px]:flex-row gap-10">
        {/* Left Column: Header, Stats, Chart, Positions */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 max-w-[720px]">
          {/* Header */}
          <PoolDetailHeader poolConfig={poolConfig} />

          {/* Stats */}
          <PoolDetailStats
            poolStats={poolStats}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />

          {/* Chart */}
          <ChartSection
            chartData={chartData}
            isLoading={isLoadingChartData}
            windowWidth={windowWidth}
          />

          {/* Positions */}
          <PoolDetailPositions
            poolConfig={poolConfig}
            poolState={poolState}
            poolAPR={poolStats.aprRaw}
            isLoadingPrices={isLoadingPrices}
            userPositions={userPositions}
            isLoadingPositions={isLoadingPositions}
            isDerivingNewPosition={isDerivingNewPosition}
            priceMap={priceMap}
            effectiveDenominationBase={effectiveDenominationBase}
            denominationBaseOverride={denominationBaseOverride}
            onDenominationToggle={handleDenominationToggle}
            onPositionClick={handlePositionClick}
            onAddLiquidity={handleAddLiquidity}
            getPositionInfo={getPositionInfo}
            convertTickToPrice={convertTickToPrice}
            calculatePositionUsd={calculatePositionUsd}
            getFeesForPosition={getFeesForPosition}
          />
        </div>

        {/* Right Column: Add Liquidity Actions - 380px matches Overview */}
        <div className="hidden min-[1400px]:block w-[380px] flex-shrink-0">
          <div className="sticky top-6 flex flex-col gap-3">
            {/* Section Title */}
            <h3 className="text-base font-semibold text-white">Add Liquidity</h3>

            {/* Rehypo Mode - Primary CTA */}
            <Button
              asChild
              className="relative w-full h-14 text-base font-semibold bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/50 hover:border-orange-400 hover:from-orange-500/30 hover:to-amber-500/30 text-white"
            >
              <Link href={`/liquidity/add?pool=${poolConfig.id}&mode=rehypo&from=pool`}>
                <Sparkles className="h-5 w-5 mr-2 text-orange-400" />
                <div className="flex flex-col items-start">
                  <span>Rehypothecation Mode</span>
                  <span className="text-xs font-normal text-orange-300/80">Recommended - Higher yield</span>
                </div>
              </Link>
            </Button>

            {/* CLMM Mode - Secondary */}
            <Button
              asChild
              variant="outline"
              className="w-full h-11 text-sm font-medium border-sidebar-border hover:bg-sidebar-accent/50"
            >
              <Link href={`/liquidity/add?pool=${poolConfig.id}&mode=concentrated&from=pool`}>
                <Settings2 className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>Concentrated Liquidity</span>
                <span className="ml-auto text-xs text-muted-foreground">Advanced</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop medium screens + Mobile: Fixed Add Liquidity Buttons */}
      <div className={cn(
        "fixed z-40",
        isMobile
          ? "bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-sidebar-border"
          : "bottom-6 right-6 min-[1400px]:hidden"
      )}>
        <div className={cn(
          "flex gap-2",
          isMobile ? "flex-col" : "flex-row"
        )}>
          {/* Rehypo Mode - Primary */}
          <Button
            asChild
            className={cn(
              "font-semibold bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/50 hover:border-orange-400 hover:from-orange-500/30 hover:to-amber-500/30 text-white",
              isMobile ? "h-12 text-base" : "h-10 px-4"
            )}
          >
            <Link href={`/liquidity/add?pool=${poolConfig.id}&mode=rehypo&from=pool`}>
              <Sparkles className="h-4 w-4 mr-2 text-orange-400" />
              Rehypo Mode
            </Link>
          </Button>

          {/* CLMM Mode - Secondary */}
          <Button
            asChild
            variant="outline"
            className={cn(
              "font-medium border-sidebar-border hover:bg-sidebar-accent/50",
              isMobile ? "h-10" : "h-10 px-3"
            )}
          >
            <Link href={`/liquidity/add?pool=${poolConfig.id}&mode=concentrated&from=pool`}>
              <Settings2 className="h-4 w-4 mr-2 text-muted-foreground" />
              CLMM
            </Link>
          </Button>
        </div>
      </div>

      {/* Position Details Modal */}
      <Suspense fallback={null}>
        {isPositionDetailsModalOpen && selectedPositionForDetails && selectedPositionInfo && (
          <PositionDetailsModal
            isOpen={isPositionDetailsModalOpen}
            onClose={() => {
              setIsPositionDetailsModalOpen(false);
              setSelectedPositionForDetails(null);
            }}
            position={selectedPositionInfo}
            valueUSD={calculatePositionUsd(selectedPositionForDetails)}
            formatTokenDisplayAmount={formatTokenDisplayAmount}
            onRefreshPosition={refreshPositions}
            currentPrice={poolState.currentPrice}
            currentPoolTick={poolState.currentPoolTick}
            onLiquidityDecreased={(info) => {
              pendingActionRef.current = { type: "decrease" };
              onLiquidityDecreasedCallback(info);
            }}
          />
        )}
      </Suspense>

    </div>
  );
});

export default PoolDetail;
