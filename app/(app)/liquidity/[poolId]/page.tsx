"use client";

import { useParams } from "next/navigation";
import { PoolDetail } from "./components/PoolDetail/PoolDetail";
import { usePoolDetailPageData } from "./hooks";

/**
 * Pool Detail Page
 *
 * Thin entry point that:
 * 1. Gets poolId from route params
 * 2. Fetches all data via usePoolDetailPageData hook
 * 3. Passes data to PoolDetail component
 *
 * All data fetching logic is in hooks/usePoolDetailPageData.ts
 * All UI logic is in components/PoolDetail/PoolDetail.tsx
 *
 * @see interface/apps/web/src/pages/PoolDetails/index.tsx (Uniswap pattern)
 */
export default function PoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId || "";

  const {
    // Pool data
    poolConfig,
    poolStats,
    poolState,
    // Chart data
    chartData,
    isLoadingChartData,
    // Positions
    userPositions,
    isLoadingPositions,
    isDerivingNewPosition,
    optimisticallyClearedFees,
    // Prices
    priceMap,
    isLoadingPrices,
    // Denomination
    effectiveDenominationBase,
    denominationBaseOverride,
    handleDenominationToggle,
    // Token definitions
    tokenDefinitions,
    // Tick utilities
    sdkMinTick,
    sdkMaxTick,
    convertTickToPrice,
    // Callbacks
    refreshPositions,
    refreshAfterLiquidityAdded,
    refreshAfterMutation,
    updatePositionOptimistically,
    removePositionOptimistically,
    clearOptimisticFees,
    clearAllOptimisticStates,
    // USD calculations
    getUsdPriceForSymbol,
    calculatePositionUsd,
  } = usePoolDetailPageData(poolId);

  return (
    <PoolDetail
      poolConfig={poolConfig}
      poolStats={poolStats}
      poolState={poolState}
      chartData={chartData}
      isLoadingChartData={isLoadingChartData}
      userPositions={userPositions}
      isLoadingPositions={isLoadingPositions}
      isDerivingNewPosition={isDerivingNewPosition}
      optimisticallyClearedFees={optimisticallyClearedFees}
      priceMap={priceMap}
      isLoadingPrices={isLoadingPrices}
      effectiveDenominationBase={effectiveDenominationBase}
      denominationBaseOverride={denominationBaseOverride}
      handleDenominationToggle={handleDenominationToggle}
      tokenDefinitions={tokenDefinitions}
      sdkMinTick={sdkMinTick}
      sdkMaxTick={sdkMaxTick}
      convertTickToPrice={convertTickToPrice}
      refreshPositions={refreshPositions}
      refreshAfterLiquidityAdded={refreshAfterLiquidityAdded}
      refreshAfterMutation={refreshAfterMutation}
      updatePositionOptimistically={updatePositionOptimistically}
      removePositionOptimistically={removePositionOptimistically}
      clearOptimisticFees={clearOptimisticFees}
      clearAllOptimisticStates={clearAllOptimisticStates}
      getUsdPriceForSymbol={getUsdPriceForSymbol}
      calculatePositionUsd={calculatePositionUsd}
    />
  );
}
