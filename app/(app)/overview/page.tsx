"use client";

import { Overview } from "./components/Overview/Overview";
import { useOverviewPageData } from "./hooks/useOverviewPageData";

/**
 * Overview Page
 *
 * Default route: /overview
 * Shows the Overview tab with:
 * - Portfolio chart (with demo wallet when disconnected)
 * - Points earned card
 * - Your Positions
 */
export default function OverviewPage() {
  const {
    totalValue,
    activePositions,
    unifiedYieldPositions,
    priceMap,
    aprByPoolId,
    isLoading,
    totalPoints,
    dailyPoints,
    leaderboardPosition,
  } = useOverviewPageData();

  return (
    <Overview
      totalValue={totalValue}
      activePositions={activePositions}
      unifiedYieldPositions={unifiedYieldPositions}
      priceMap={priceMap}
      aprByPoolId={aprByPoolId}
      isLoading={isLoading}
      totalPoints={totalPoints}
      dailyPoints={dailyPoints}
      leaderboardPosition={leaderboardPosition}
    />
  );
}
