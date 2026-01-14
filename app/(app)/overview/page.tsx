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
 * - Mini tables (Pools, Tokens)
 */
export default function OverviewPage() {
  const {
    totalValue,
    walletBalances,
    activePositions,
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
      walletBalances={walletBalances}
      activePositions={activePositions}
      priceMap={priceMap}
      aprByPoolId={aprByPoolId}
      isLoading={isLoading}
      totalPoints={totalPoints}
      dailyPoints={dailyPoints}
      leaderboardPosition={leaderboardPosition}
    />
  );
}
