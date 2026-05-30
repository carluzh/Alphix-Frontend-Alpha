"use client";

import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Minus } from "lucide-react";
import { DenominationToggle } from "@/components/liquidity/DenominationToggle";
import { CurrencyAmount, Price, Currency } from "@uniswap/sdk-core";
import { Position as V4Position } from "@uniswap/v4-sdk";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PoolConfig } from "@/lib/pools-config";
import type { LPType, ChartDuration, PositionInfo, PoolStateData } from "../../hooks";
import type { NetworkMode } from "@/lib/network-mode";
import dynamic from "next/dynamic";
import { usePositionFeeChartData, useUnifiedYieldChartData, type ChartPeriod } from "../../hooks";
import type { TimePeriod } from "../PriceChartSection";
import { ChartLoadingSkeleton, LoadingSkeleton } from "./skeletons";
import { PositionHeader, PriceRangeSection, PositionValueSection, EarningsSection } from "./sections";
import { EarningSourcesSection } from "./earning-sources";

const PriceChartSection = dynamic(
  () => import("../PriceChartSection").then(mod => mod.PriceChartSection),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);
const YieldChartSection = dynamic(
  () => import("../YieldChartSection").then(mod => mod.YieldChartSection),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { IncreaseLiquidityModal } from "@/components/liquidity/increase/IncreaseLiquidityModal";
import { DecreaseLiquidityModal } from "@/components/liquidity/decrease/DecreaseLiquidityModal";
import { CollectFeesModal } from "@/components/liquidity/collect/CollectFeesModal";
import {
  adaptUnifiedYieldToProcessedPosition,
  type UnifiedYieldPosition,
} from "@/lib/liquidity/unified-yield";
import { usePriceDeviation, requiresDeviationAcknowledgment } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout, PoolOutOfRangeCallout } from "@/components/ui/PriceDeviationCallout";
import { HighRiskConfirmModal, createPriceDeviationWarning } from "@/components/ui/HighRiskConfirmModal";

// ============================================================================
// Types
// ============================================================================

export interface PositionDetailProps {
  tokenId: string;
  // Position data
  position: V4Position | null;
  positionInfo: PositionInfo | null;
  unifiedYieldPosition: UnifiedYieldPosition | null;
  isLoading: boolean;
  error: Error | null;
  // Pool data
  poolConfig: PoolConfig | null;
  poolState: PoolStateData | null;
  // Token amounts
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  // USD values
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  // Fees
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  // Price info
  currentPrice: Price<Currency, Currency> | null;
  currentPriceNumeric: number | null;
  priceInverted: boolean;
  setPriceInverted: (inverted: boolean) => void;
  // Range display
  minPrice: string;
  maxPrice: string;
  tokenASymbol?: string;
  tokenBSymbol?: string;
  isFullRange?: boolean;
  isInRange: boolean;
  poolOutsideRange: boolean;
  // APR data
  poolApr: number | null;
  aaveApr: number | null;
  aprBySource?: Record<'aave', number>;
  totalApr: number | null;
  // LP Type
  lpType: LPType;
  // Chart
  chartDuration: ChartDuration;
  setChartDuration: (duration: ChartDuration) => void;
  chartData: { time: number; value: number }[];
  isLoadingChart: boolean;
  // Denomination
  effectiveDenominationBase: boolean;
  handleDenominationToggle: () => void;
  // Ownership
  isOwner: boolean;
  // Actions
  refetch: () => void;
  // Navigation origin (for breadcrumb)
  fromPage: "overview" | "pool" | null;
}

// ============================================================================
// Main Component
// ============================================================================

export const PositionDetail = memo(function PositionDetail({
  tokenId,
  position,
  positionInfo,
  unifiedYieldPosition,
  isLoading,
  error,
  poolConfig,
  poolState,
  currency0Amount,
  currency1Amount,
  fiatValue0,
  fiatValue1,
  totalPositionValue,
  fee0Amount,
  fee1Amount,
  fiatFeeValue0,
  fiatFeeValue1,
  totalFeesValue,
  currentPrice,
  currentPriceNumeric,
  priceInverted,
  setPriceInverted,
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  isInRange,
  poolOutsideRange,
  poolApr,
  aaveApr,
  aprBySource,
  totalApr,
  lpType,
  chartDuration,
  setChartDuration,
  chartData,
  isLoadingChart,
  effectiveDenominationBase,
  handleDenominationToggle,
  isOwner,
  refetch,
  fromPage,
}: PositionDetailProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Use pool's chain, not wallet's chain — ensures correct token icons, colors, and API calls
  const networkMode = poolConfig?.networkMode ?? 'base' as NetworkMode;

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

  // Detect if this is a Unified Yield position (derived from lpType prop)
  const isUnifiedYield = lpType === "rehypo";

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [showPriceDeviationModal, setShowPriceDeviationModal] = useState(false);
  // Default to Yield chart for Unified Yield positions, Price chart for V4
  const [chartTab, setChartTab] = useState<"price" | "yield">(isUnifiedYield ? "yield" : "price");
  const [feeChartPeriod, setFeeChartPeriod] = useState<ChartPeriod>("1W");

  // Price deviation check - compare pool price vs market price
  // Always pass canonical pool price (not display price) - deviation is denomination-agnostic
  const priceDeviation = usePriceDeviation({
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    poolPrice: currentPriceNumeric,
  });

  // Fee chart data for V4 positions - pass current uncollected fees for "live now" point
  const {
    data: feeChartData,
    isLoading: isLoadingFeeChart,
    refetch: refetchFeeChart,
  } = usePositionFeeChartData({
    positionId: tokenId,
    period: feeChartPeriod,
    currentFeesUsd: totalFeesValue ?? undefined,
    enabled: chartTab === "yield" && !!tokenId && !isUnifiedYield,
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    isRehypo: false, // V4 positions only
    networkModeOverride: networkMode,
  });

  // Unified Yield chart data - shows Swap APR + per-token yield source APRs
  const {
    data: uyChartData,
    currency0Protocol: uyC0Protocol,
    currency1Protocol: uyC1Protocol,
    isLoading: isLoadingUyChart,
    refetch: refetchUyChart,
  } = useUnifiedYieldChartData({
    poolId: poolConfig?.poolId,
    period: feeChartPeriod,
    yieldSources: poolConfig?.yieldSources,
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    currentSwapApr: poolApr,
    enabled: chartTab === "yield" && !!poolConfig?.poolId && isUnifiedYield,
    networkModeOverride: networkMode,
  });

  // Transform UY chart data to format expected by YieldChartSection
  const transformedUyChartData = useMemo(() => {
    if (!uyChartData) return [];

    return uyChartData.map((point) => ({
      timestamp: point.timestamp,
      apr: point.swapApr,
      currency0Apy: point.currency0Apy,
      currency1Apy: point.currency1Apy,
      feesUsd: 0,
      accumulatedFeesUsd: 0,
      totalApr: point.totalApr ?? (point.swapApr + (point.currency0Apy ?? 0) * 0.5 + (point.currency1Apy ?? 0) * 0.5),
    }));
  }, [uyChartData]);

  // Compute yield source labels and colors for chart legend
  const { c0YieldLabel, c1YieldLabel, c0YieldColor, c1YieldColor } = useMemo(() => {
    const token0Sym = poolConfig?.currency0?.symbol ?? "";
    const token1Sym = poolConfig?.currency1?.symbol ?? "";

    const c0Label = uyC0Protocol ? `Aave ${token0Sym}` : `Yield ${token0Sym}`;
    const c1Label = uyC1Protocol ? `Aave ${token1Sym}` : `Yield ${token1Sym}`;

    // Colors: lighter shade when both tokens use Aave
    const bothAave = uyC0Protocol === 'aave' && uyC1Protocol === 'aave';
    const c0Color = "#9896FF";
    const c1Color = bothAave ? "#C4C2FF" : "#9896FF";

    return { c0YieldLabel: c0Label, c1YieldLabel: c1Label, c0YieldColor: c0Color, c1YieldColor: c1Color };
  }, [poolConfig?.currency0?.symbol, poolConfig?.currency1?.symbol, uyC0Protocol, uyC1Protocol]);

  // Select the appropriate chart data based on position type
  const yieldChartData = isUnifiedYield ? transformedUyChartData : (feeChartData ?? []);
  const isLoadingYieldChart = isUnifiedYield ? isLoadingUyChart : isLoadingFeeChart;
  const refetchYieldChart = isUnifiedYield ? refetchUyChart : refetchFeeChart;

  // Convert position data to ProcessedPosition format for modals
  // Uses the shared adapter for Unified Yield positions
  const processedPosition: ProcessedPosition | null = useMemo(() => {
    if (!poolConfig) return null;

    // For Unified Yield positions, use the shared adapter
    if (isUnifiedYield && unifiedYieldPosition) {
      return adaptUnifiedYieldToProcessedPosition(unifiedYieldPosition, networkMode);
    }

    // For V4 positions, need positionInfo
    if (!position || !positionInfo) return null;

    return {
      type: 'v4' as const,
      positionId: tokenId,
      owner: positionInfo.owner,
      poolId: poolConfig.slug,
      token0: {
        address: poolConfig.currency0.address,
        symbol: poolConfig.currency0.symbol,
        amount: currency0Amount?.toExact() || "0",
        rawAmount: currency0Amount?.quotient.toString() || "0",
      },
      token1: {
        address: poolConfig.currency1.address,
        symbol: poolConfig.currency1.symbol,
        amount: currency1Amount?.toExact() || "0",
        rawAmount: currency1Amount?.quotient.toString() || "0",
      },
      tickLower: positionInfo.tickLower,
      tickUpper: positionInfo.tickUpper,
      liquidityRaw: positionInfo.liquidity.toString(),
      ageSeconds: 0, // Not critical for modals
      blockTimestamp: 0,
      lastTimestamp: 0,
      isInRange,
      token0UncollectedFees: fee0Amount?.toExact() || "0",
      token1UncollectedFees: fee1Amount?.toExact() || "0",
      networkMode: networkMode,
    };
  }, [position, poolConfig, positionInfo, tokenId, currency0Amount, currency1Amount, isInRange, fee0Amount, fee1Amount, isUnifiedYield, unifiedYieldPosition, networkMode]);

  // Modal handlers
  const handleOpenAddModal = useCallback(() => {
    // Check if high price deviation requires acknowledgment first
    if (requiresDeviationAcknowledgment(priceDeviation.severity)) {
      setShowPriceDeviationModal(true);
    } else {
      setIsAddModalOpen(true);
    }
  }, [priceDeviation.severity]);
  const handleCloseAddModal = useCallback(() => setIsAddModalOpen(false), []);
  const handleOpenRemoveModal = useCallback(() => setIsRemoveModalOpen(true), []);
  const handleCloseRemoveModal = useCallback(() => setIsRemoveModalOpen(false), []);
  const handleOpenCollectModal = useCallback(() => setIsCollectModalOpen(true), []);
  const handleCloseCollectModal = useCallback(() => setIsCollectModalOpen(false), []);

  // Price deviation confirmation handler - opens the add modal after acknowledgment
  const handlePriceDeviationConfirm = useCallback(() => {
    setShowPriceDeviationModal(false);
    setIsAddModalOpen(true);
  }, []);

  // Handle modal success - invalidate React Query caches and refetch.
  //
  // The position page uses React Query (not Apollo) for ["position", "v4", tokenId, networkMode]
  // and ["unified-yield-position-detail", ...]. invalidateAfterTx() inside the modal
  // refreshes the Apollo cache (used by Overview) but does NOT touch React Query.
  //
  // We mirror Uniswap's 2-layer pattern: invalidate immediately (so the next render
  // marks queries stale), then refetch after a 3s delay to give the backend indexer
  // time to catch up to the on-chain state. Refetching immediately races the indexer
  // and surfaces stale data to the user.
  const REFETCH_DELAY_MS = 3000;
  const invalidatePositionQueries = useCallback(() => {
    if (isUnifiedYield) {
      queryClient.invalidateQueries({ queryKey: ["unified-yield-position-detail"] }).catch(() => {});
    } else {
      queryClient.invalidateQueries({ queryKey: ["position", "v4", tokenId, networkMode] }).catch(() => {});
    }
  }, [queryClient, isUnifiedYield, tokenId, networkMode]);

  const handleModalSuccess = useCallback(() => {
    invalidatePositionQueries();
    window.setTimeout(() => {
      refetch();
      refetchYieldChart();
    }, REFETCH_DELAY_MS);
  }, [invalidatePositionQueries, refetch, refetchYieldChart]);

  // Handle decrease modal success - navigate to overview on full burn
  const handleDecreaseSuccess = useCallback((options?: { isFullBurn?: boolean }) => {
    if (options?.isFullBurn) {
      router.push('/overview');
    } else {
      invalidatePositionQueries();
      window.setTimeout(() => {
        refetch();
        refetchYieldChart();
      }, REFETCH_DELAY_MS);
    }
  }, [router, invalidatePositionQueries, refetch, refetchYieldChart]);

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground">Failed to load position</p>
        <Button variant="outline" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  // Not found state
  // For Unified Yield: position is null but poolConfig should exist
  // For V4: both position and poolConfig should exist
  const hasValidData = isUnifiedYield
    ? (poolConfig !== null && currency0Amount !== null)
    : (position !== null && poolConfig !== null);

  if (!hasValidData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <h2 className="text-2xl font-semibold">Position not found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          This position may have been closed or doesn't exist.
        </p>
        <Button onClick={() => router.push("/overview")}>
          Back to Positions
        </Button>
      </div>
    );
  }

  // poolConfig is guaranteed non-null after the hasValidData guard above
  const token0Symbol = poolConfig!.currency0.symbol;
  const token1Symbol = poolConfig!.currency1.symbol;

  // For Unified Yield positions, fees auto-compound so no manual collection needed
  const hasFees = !isUnifiedYield && totalFeesValue !== null && totalFeesValue > 0;

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto pb-20 sm:pb-6">
      {/* Header with Action Buttons */}
      <PositionHeader
        poolConfig={poolConfig!}
        lpType={lpType}
        isInRange={isInRange}
        isOwner={isOwner}
        hasFees={hasFees}
        onAddLiquidity={handleOpenAddModal}
        onRemoveLiquidity={handleOpenRemoveModal}
        onCollectFees={handleOpenCollectModal}
        networkMode={networkMode}
        fromPage={fromPage}
      />

      {/* Right Column content - Mobile only: appears above chart when stacked */}
      <div className="flex flex-col gap-4 xl:hidden">
        {/* Uncollected Fees - Show first when > 0 */}
        {hasFees && (
          <EarningsSection
            fee0Amount={fee0Amount}
            fee1Amount={fee1Amount}
            fiatFeeValue0={fiatFeeValue0}
            fiatFeeValue1={fiatFeeValue1}
            totalFeesValue={totalFeesValue}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            networkMode={networkMode}
          />
        )}

        {/* Position Value */}
        <PositionValueSection
          currency0Amount={currency0Amount}
          currency1Amount={currency1Amount}
          fiatValue0={fiatValue0}
          fiatValue1={fiatValue1}
          totalPositionValue={totalPositionValue}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          networkMode={networkMode}
        />

        {poolOutsideRange ? (
          <PoolOutOfRangeCallout />
        ) : priceDeviation.severity !== 'none' && poolConfig && (
          <PriceDeviationCallout
            deviation={priceDeviation}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            variant="card"
          />
        )}

        {/* APR */}
        <EarningSourcesSection
          yieldSources={poolConfig?.yieldSources}
          aprBySource={aprBySource}
        />
      </div>

      {/* Two-column layout - matches PoolDetail pattern */}
      <div className="flex flex-col xl:flex-row gap-10">
        {/* Left Column: Chart & Price Range */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full overflow-hidden">
          {/* Chart Tabs + Denomination Toggle */}
          <div className="flex flex-row items-center justify-between gap-2 min-w-0">
            <div className="flex flex-row items-center gap-1">
              <button
                onClick={() => setChartTab("price")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "price"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Price
              </button>
              <button
                onClick={() => setChartTab("yield")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "yield"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Yield
              </button>
            </div>

            {/* Denomination Toggle */}
            <DenominationToggle
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              activeBase={priceInverted ? token1Symbol : token0Symbol}
              onToggle={(symbol) => {
                const shouldInvert = symbol === token1Symbol;
                if (shouldInvert !== priceInverted) {
                  setPriceInverted(shouldInvert);
                }
              }}
              networkMode={networkMode}
            />
          </div>

          {/* Price Chart - no background container */}
          {chartTab === "price" ? (
            <PriceChartSection
              chartData={chartData}
              isLoading={isLoadingChart}
              windowWidth={windowWidth}
              currentPrice={currentPriceNumeric ?? undefined}
              minRangePrice={!isFullRange && minPrice ? parseFloat(minPrice) : undefined}
              maxRangePrice={!isFullRange && maxPrice ? parseFloat(maxPrice) : undefined}
              priceInverted={priceInverted}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              timePeriod={chartDuration as TimePeriod}
              onTimePeriodChange={(period) => setChartDuration(period as ChartDuration)}
            />
          ) : (
            <YieldChartSection
              chartData={yieldChartData}
              isLoading={isLoadingYieldChart}
              windowWidth={windowWidth}
              currentFees={isUnifiedYield ? undefined : (totalFeesValue ?? undefined)}
              timePeriod={feeChartPeriod}
              onTimePeriodChange={(period) => setFeeChartPeriod(period)}
              isUnifiedYield={isUnifiedYield}
              currency0YieldLabel={c0YieldLabel}
              currency1YieldLabel={c1YieldLabel}
              currency0YieldColor={c0YieldColor}
              currency1YieldColor={c1YieldColor}
            />
          )}

          {/* Price Range */}
          <PriceRangeSection
            minPrice={minPrice}
            maxPrice={maxPrice}
            tokenASymbol={tokenASymbol ?? ''}
            tokenBSymbol={tokenBSymbol ?? ''}
            isFullRange={isFullRange ?? false}
            currentPriceNumeric={currentPriceNumeric}
            priceInverted={priceInverted}
            poolType={poolConfig?.type}
            poolOutsideRange={poolOutsideRange}
          />
        </div>

        {/* Right Column: Position Info - Desktop only (xl+) - 380px matches Overview/PoolDetail */}
        <div className="hidden xl:flex flex-col gap-4 w-full xl:w-[380px] flex-shrink-0">
          {/* Uncollected Fees - Show first when > 0 */}
          {hasFees && (
            <EarningsSection
              fee0Amount={fee0Amount}
              fee1Amount={fee1Amount}
              fiatFeeValue0={fiatFeeValue0}
              fiatFeeValue1={fiatFeeValue1}
              totalFeesValue={totalFeesValue}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              networkMode={networkMode}
            />
          )}

          {/* Position Value */}
          <PositionValueSection
            currency0Amount={currency0Amount}
            currency1Amount={currency1Amount}
            fiatValue0={fiatValue0}
            fiatValue1={fiatValue1}
            totalPositionValue={totalPositionValue}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            networkMode={networkMode}
          />

          {poolOutsideRange ? (
            <PoolOutOfRangeCallout />
          ) : priceDeviation.severity !== 'none' && poolConfig && (
            <PriceDeviationCallout
              deviation={priceDeviation}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              variant="card"
            />
          )}

          {/* Earning on sources */}
          <EarningSourcesSection
            yieldSources={poolConfig?.yieldSources}
            aprBySource={aprBySource}
          />
        </div>
      </div>

      {/* Mobile Fixed Action Buttons - Only show Collect fees if there are fees */}
      {isMobile && isOwner && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-sidebar-border z-40 sm:hidden">
          <div className="flex gap-2">
            {hasFees && (
              <Button onClick={handleOpenCollectModal} className="flex-1 h-12 font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary">
                Collect fees
              </Button>
            )}
            <Button onClick={handleOpenAddModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Plus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Add</span>}
            </Button>
            <Button onClick={handleOpenRemoveModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Minus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Remove</span>}
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {processedPosition && (
        <>
          <IncreaseLiquidityModal
            position={processedPosition}
            isOpen={isAddModalOpen}
            onClose={handleCloseAddModal}
            onSuccess={handleModalSuccess}
          />
          <DecreaseLiquidityModal
            position={processedPosition}
            isOpen={isRemoveModalOpen}
            onClose={handleCloseRemoveModal}
            onSuccess={handleDecreaseSuccess}
          />
          <CollectFeesModal
            position={processedPosition}
            isOpen={isCollectModalOpen}
            onClose={handleCloseCollectModal}
            onSuccess={handleModalSuccess}
          />
        </>
      )}

      {/* Price Deviation Confirmation Modal */}
      {poolConfig && priceDeviation.absoluteDeviation !== null && (
        <HighRiskConfirmModal
          isOpen={showPriceDeviationModal}
          onClose={() => setShowPriceDeviationModal(false)}
          onConfirm={handlePriceDeviationConfirm}
          warnings={[createPriceDeviationWarning({
            poolPrice: priceDeviation.poolPrice,
            marketPrice: priceDeviation.marketPrice,
            deviationPercent: priceDeviation.absoluteDeviation,
            direction: priceDeviation.direction ?? 'below',
            token0Symbol: poolConfig.currency0.symbol,
            token1Symbol: poolConfig.currency1.symbol,
          })]}
          confirmText="Proceed with Add Liquidity"
        />
      )}
    </div>
  );
});

export default PositionDetail;
