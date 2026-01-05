"use client";

import { Points } from "./components/Points";
import { usePointsPageData } from "./hooks/usePointsPageData";

/**
 * Points Page
 *
 * Route: /points
 * Shows the Points dashboard with:
 * - Points Inventory hero card (balance + daily rate)
 * - Dynamic stats panel (changes based on selected tab)
 * - Tabbed section: History | Leaderboard
 */
export default function PointsPage() {
  const {
    totalPoints,
    dailyRate,
    leaderboardPosition,
    totalParticipants,
    volumePoints,
    liquidityPoints,
    referralPoints,
    recentPointsEarned,
    pointsHistory,
    leaderboardData,
    accountAddress,
    isLoading,
  } = usePointsPageData();

  return (
    <Points
      totalPoints={totalPoints}
      dailyRate={dailyRate}
      leaderboardPosition={leaderboardPosition}
      totalParticipants={totalParticipants}
      volumePoints={volumePoints}
      liquidityPoints={liquidityPoints}
      referralPoints={referralPoints}
      recentPointsEarned={recentPointsEarned}
      pointsHistory={pointsHistory}
      leaderboardData={leaderboardData}
      accountAddress={accountAddress}
      isLoading={isLoading}
    />
  );
}
