"use client";

import { memo, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import type { V4ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";

/** Position union type - V4 and Unified Yield positions fetched through separate flows */
type Position = V4ProcessedPosition | UnifiedYieldPosition;
import type { TokenSymbol } from "@/lib/pools-config";
import { useQuery } from "@tanstack/react-query";
import { fetchAaveRates, getLendingAprForPair } from "@/lib/aave-rates";

import dynamic from "next/dynamic";
import { PoolDetailHeader } from "./PoolDetailHeader";
import { PoolDetailStats } from "./PoolDetailStats";
import { PoolDetailPositions } from "./PoolDetailPositions";
import { PoolDetailSidebar } from "./PoolDetailSidebar";

// Chart loading skeleton - matches ChartSection dimensions (300px height)
const CHART_HEIGHT = 300;
const TIME_SCALE_HEIGHT = 26;
const PRICE_SCALE_WIDTH = 55;

function ChartLoadingSkeleton() {
  const dotPattern = `radial-gradient(circle, #333333 1px, transparent 1px)`;
  return (
    <div className="flex flex-col gap-4">
      {/* Chart type tabs skeleton */}
      <div className="flex flex-row items-center gap-1 opacity-50">
        {["Fee", "Volume", "TVL"].map((tab) => (
          <div key={tab} className="h-7 px-2.5 text-xs rounded-md bg-muted/20 text-muted-foreground">
            {tab}
          </div>
        ))}
      </div>
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {/* Pattern overlay */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            right: PRICE_SCALE_WIDTH,
            bottom: TIME_SCALE_HEIGHT,
            backgroundImage: dotPattern,
            backgroundSize: "24px 24px",
          }}
        />
        {/* Header skeleton */}
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <div className="h-9 w-20 bg-muted/20 animate-pulse rounded" />
            <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
          </div>
        </div>
      </div>
      {/* Time period selector skeleton */}
      <div className="flex flex-row items-center gap-1 opacity-50">
        {["1W", "1M", "All"].map((opt) => (
          <div key={opt} className="h-7 px-2.5 text-xs rounded-md bg-muted/20 text-muted-foreground">
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

const ChartSection = dynamic(
  () => import("../ChartSection").then(mod => mod.ChartSection),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);
import type {
  PoolConfig,
  PoolStats,
  PoolStateData,
  ChartDataPoint,
} from "../../hooks";

export interface PoolDetailProps {
  // Pool data
  poolConfig: PoolConfig | null;
  poolStats: PoolStats;
  poolState: PoolStateData;

  // Chart data
  chartData: ChartDataPoint[];
  isLoadingChartData: boolean;

  // Positions (discriminated union of V4 and Unified Yield)
  userPositions: Position[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;

  // Prices
  priceMap: Record<string, number>;
  isLoadingPrices: boolean;

  // Token definitions
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>;

  // Responsive
  windowWidth: number;

  // Tick utilities
  convertTickToPrice: (
    tick: number,
    currentPoolTick: number | null,
    currentPrice: string | null,
    baseTokenForPriceDisplay: string,
    token0Symbol: string,
    token1Symbol: string
  ) => string;

  // USD calculations (handles both V4 and Unified Yield positions)
  calculatePositionUsd: (position: Position) => number;
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
  tokenDefinitions,
  windowWidth,
  convertTickToPrice,
  calculatePositionUsd,
}: PoolDetailProps) {
  const router = useRouter();
  const { chainId } = useAccount();

  // Fetch Aave rates for Unified Yield display
  const { data: aaveRatesData } = useQuery({
    queryKey: ['aaveRates'],
    queryFn: fetchAaveRates,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Calculate lending yield APR (with pool-level factor applied)
  const aaveApr = useMemo(() => {
    if (!poolConfig) return undefined;
    const token0 = poolConfig.tokens[0]?.symbol;
    const token1 = poolConfig.tokens[1]?.symbol;
    if (!token0 || !token1) return undefined;
    return getLendingAprForPair(aaveRatesData, token0, token1) ?? undefined;
  }, [poolConfig, aaveRatesData]);

  // =========================================================================
  // POSITION INFO CONVERSION (V4 positions only)
  // =========================================================================
  const getPositionInfo = useCallback(
    (position: V4ProcessedPosition, feeData?: { amount0?: string; amount1?: string }): PositionInfo | undefined => {
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
  // FEE DATA EXTRACTION (V4 positions only - UY positions don't have uncollected fees)
  // =========================================================================
  const getFeesForPosition = useCallback(
    (positionId: string, position?: V4ProcessedPosition) => {
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
  // HANDLERS
  // =========================================================================
  const handleAddLiquidity = useCallback(() => {
    // Navigate to the new wizard flow with pool pre-selected
    // This skips Token Selection and LP Option steps (pool already known)
    if (poolConfig?.id) {
      router.push(`/liquidity/add?pool=${poolConfig.id}&mode=rehypo&from=pool`);
    }
  }, [poolConfig?.id, router]);

  const handlePositionClick = useCallback((position: Position) => {
    router.push(`/liquidity/position/${position.positionId}?from=pool`);
  }, [router]);

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
    <div className="flex flex-col gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto pb-6">
      {/* Header - spans full width like Position page */}
      <PoolDetailHeader poolConfig={poolConfig} />

      {/* Two-column layout on desktop - matches Overview page ratios */}
      <div className="flex flex-col xl:flex-row gap-10">
        {/* Left Column: Stats, Chart (Positions moved out for mobile ordering) */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full">
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

          {/* Positions - Only visible on desktop (xl+) */}
          <div className="hidden xl:block">
            <PoolDetailPositions
              poolConfig={poolConfig}
              poolState={poolState}
              poolAPR={poolStats.aprRaw}
              isLoadingPrices={isLoadingPrices}
              userPositions={userPositions}
              isLoadingPositions={isLoadingPositions}
              isDerivingNewPosition={isDerivingNewPosition}
              priceMap={priceMap}
              onPositionClick={handlePositionClick}
              onAddLiquidity={handleAddLiquidity}
              getPositionInfo={getPositionInfo}
              convertTickToPrice={convertTickToPrice}
              calculatePositionUsd={calculatePositionUsd}
              getFeesForPosition={getFeesForPosition}
            />
          </div>
        </div>

        {/* Right Column: Add Liquidity Actions + Pool Info - 380px matches Overview */}
        <div className="w-full xl:w-[380px] flex-shrink-0">
          <div className="xl:sticky xl:top-6">
            <PoolDetailSidebar
              poolConfig={poolConfig}
              poolApr={poolStats.aprRaw}
              aaveApr={aaveApr}
            />
          </div>
        </div>
      </div>

      {/* Positions - Mobile only (below xl): appears after sidebar when stacked */}
      <div className="xl:hidden">
        <PoolDetailPositions
          poolConfig={poolConfig}
          poolState={poolState}
          poolAPR={poolStats.aprRaw}
          isLoadingPrices={isLoadingPrices}
          userPositions={userPositions}
          isLoadingPositions={isLoadingPositions}
          isDerivingNewPosition={isDerivingNewPosition}
          priceMap={priceMap}
          onPositionClick={handlePositionClick}
          onAddLiquidity={handleAddLiquidity}
          getPositionInfo={getPositionInfo}
          convertTickToPrice={convertTickToPrice}
          calculatePositionUsd={calculatePositionUsd}
          getFeesForPosition={getFeesForPosition}
        />
      </div>
    </div>
  );
});

export default PoolDetail;
