"use client";

import { Points } from "./components/Points";
import { usePointsPageData } from "./hooks/usePointsPageData";
import { useReferralData } from "./hooks/useReferralData";

/**
 * Points Page
 *
 * Route: /points
 * Shows the Points dashboard with:
 * - Points Inventory hero card (balance + daily rate)
 * - Dynamic stats panel (changes based on selected tab)
 * - Tabbed section: History | Leaderboard | Referral
 */
export default function PointsPage() {
  const {
    totalPoints,
    dailyRate,
    leaderboardPosition,
    totalParticipants,
    seasonStartDate,
    volumePoints,
    liquidityPoints,
    referralPoints,
    recentPointsEarned,
    pointsHistory,
    leaderboardData,
    accountAddress,
    isLoading,
  } = usePointsPageData();

  const {
    // Stats
    totalReferees,
    totalReferredTvlUsd,
    totalReferredVolumeUsd,
    // My code
    myCode,
    getOrCreateReferralCode,
    // My referrer
    myReferrer,
    myReferrerCode,
    joinedAt,
    // Referees list
    referees,
    // Actions
    applyReferralCode,
    // State
    isLoading: isReferralLoading,
  } = useReferralData();

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
      seasonStartDate={seasonStartDate}
      isLoading={isLoading || isReferralLoading}
      // Referral stats
      totalReferees={totalReferees}
      totalReferredTvlUsd={totalReferredTvlUsd}
      totalReferredVolumeUsd={totalReferredVolumeUsd}
      // Referral data
      myReferralCode={myCode}
      getOrCreateReferralCode={getOrCreateReferralCode}
      myReferrer={myReferrer}
      myReferrerCode={myReferrerCode}
      referrerJoinedAt={joinedAt}
      referees={referees}
      applyReferralCode={applyReferralCode}
    />
  );
}
