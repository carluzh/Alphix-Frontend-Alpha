"use client";

import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";
import { useQuery } from "@tanstack/react-query";
import { fetchAaveRates, getAaveKey } from "@/lib/aave-rates";

import { PoolDetailHeader } from "./PoolDetailHeader";
import { PoolDetailStats } from "./PoolDetailStats";
import { PoolDetailPositions } from "./PoolDetailPositions";
import { PoolDetailSidebar } from "./PoolDetailSidebar";
import { ChartSection } from "../ChartSection";
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

  // Positions
  userPositions: ProcessedPosition[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;

  // Prices
  priceMap: Record<string, number>;
  isLoadingPrices: boolean;

  // Token definitions
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>;

  // Tick utilities
  convertTickToPrice: (
    tick: number,
    currentPoolTick: number | null,
    currentPrice: string | null,
    baseTokenForPriceDisplay: string,
    token0Symbol: string,
    token1Symbol: string
  ) => string;

  // USD calculations
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
  tokenDefinitions,
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

  // Calculate Aave APY based on pool tokens
  const aaveApr = useMemo(() => {
    if (!poolConfig || !aaveRatesData?.success) return undefined;

    const token0Symbol = poolConfig.tokens[0]?.symbol;
    const token1Symbol = poolConfig.tokens[1]?.symbol;
    if (!token0Symbol || !token1Symbol) return undefined;

    const key0 = getAaveKey(token0Symbol);
    const key1 = getAaveKey(token1Symbol);

    const apy0 = key0 && aaveRatesData.data[key0] ? aaveRatesData.data[key0].apy : null;
    const apy1 = key1 && aaveRatesData.data[key1] ? aaveRatesData.data[key1].apy : null;

    // Average if both tokens supported, otherwise use single token's APY
    if (apy0 !== null && apy1 !== null) {
      return (apy0 + apy1) / 2;
    }
    return apy0 ?? apy1 ?? undefined;
  }, [poolConfig, aaveRatesData]);

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
    router.push(`/liquidity/position/${position.positionId}`);
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
      <div className="flex flex-col min-[1200px]:flex-row gap-10">
        {/* Left Column: Stats, Chart, Positions */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
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
            onPositionClick={handlePositionClick}
            onAddLiquidity={handleAddLiquidity}
            getPositionInfo={getPositionInfo}
            convertTickToPrice={convertTickToPrice}
            calculatePositionUsd={calculatePositionUsd}
            getFeesForPosition={getFeesForPosition}
          />
        </div>

        {/* Right Column: Add Liquidity Actions + Pool Info - 380px matches Overview */}
        <div className="hidden min-[1200px]:block w-[380px] flex-shrink-0">
          <div className="sticky top-6">
            <PoolDetailSidebar
              poolConfig={poolConfig}
              poolApr={poolStats.aprRaw}
              aaveApr={aaveApr}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

export default PoolDetail;
