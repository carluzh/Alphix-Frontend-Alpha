"use client";

import { useParams } from "next/navigation";
import { PoolDetail } from "./components/PoolDetail/PoolDetail";
import { usePoolDetailPageData } from "./hooks";

/**
 * Pool Detail Page - thin entry point that extracts poolId and delegates to content.
 * Key prop on PoolDetailContent forces remount on pool change, ensuring fresh state.
 */
export default function PoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId || "";

  return <PoolDetailContent key={poolId} poolId={poolId} />;
}

function PoolDetailContent({ poolId }: { poolId: string }) {
  const {
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
      tokenDefinitions={tokenDefinitions}
      windowWidth={windowWidth}
      convertTickToPrice={convertTickToPrice}
      calculatePositionUsd={calculatePositionUsd}
    />
  );
}
