"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PoolDetail } from "./components/PoolDetail/PoolDetail";
import { usePoolDetailPageData } from "./hooks";
import type { NetworkMode } from "@/lib/network-mode";

function chainParamToNetworkMode(chain: string | null): NetworkMode | undefined {
  if (chain === 'arbitrum') return 'arbitrum';
  if (chain === 'base') return 'base';
  return undefined;
}

/**
 * Pool Detail Page - thin entry point that extracts poolId and delegates to content.
 * Key prop on PoolDetailContent forces remount on pool change, ensuring fresh state.
 */
export default function PoolDetailPage() {
  const params = useParams<{ poolId: string }>();
  const searchParams = useSearchParams();
  const poolId = params?.poolId || "";
  const chainParam = searchParams?.get('chain') ?? null;
  const networkMode = chainParamToNetworkMode(chainParam);

  return <PoolDetailContent key={`${poolId}-${chainParam}`} poolId={poolId} networkMode={networkMode} />;
}

function PoolDetailContent({ poolId, networkMode }: { poolId: string; networkMode?: NetworkMode }) {
  const {
    poolConfig,
    poolStats,
    poolState,
    chartData,
    feeEvents,
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
  } = usePoolDetailPageData(poolId, networkMode);

  // Use pool's resolved networkMode (from pool config), not just the URL param override
  const resolvedNetworkMode = poolConfig?.networkMode ?? networkMode;

  return (
    <PoolDetail
      networkMode={resolvedNetworkMode}
      poolConfig={poolConfig}
      poolStats={poolStats}
      poolState={poolState}
      chartData={chartData}
      feeEvents={feeEvents}
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
