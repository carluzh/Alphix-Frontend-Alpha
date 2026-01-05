"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { PointsInventoryCard } from "./PointsInventoryCard";
import { PointsConnectWalletBanner } from "./PointsConnectWalletBanner";
import { PointsStatsPanel } from "./PointsStatsPanel";
import { PointsTabsSection } from "./PointsTabsSection";
import { SeasonTimelineBanner } from "./SeasonTimelineBanner";
import type { PointsHistoryEntry, LeaderboardEntry } from "../hooks/usePointsPageData";

// Season 0 start date (mock - set to recent past so there's time remaining)
const SEASON_0_START = new Date("2025-12-01T00:00:00Z");

// Constants
const POINTS_RIGHT_COLUMN_WIDTH = 380;

export type PointsTab = "history" | "leaderboard" | "referral";

interface PointsProps {
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  totalParticipants: number;
  volumePoints?: number;
  liquidityPoints?: number;
  referralPoints?: number;
  recentPointsEarned?: number;
  pointsHistory: PointsHistoryEntry[];
  leaderboardData: LeaderboardEntry[];
  accountAddress?: string;
  isLoading?: boolean;
}

/**
 * Points
 *
 * Layout Structure:
 * 1. SEASON TIMELINE: Full-width banner showing season & week progress
 * 2. MAIN SECTION: Points Inventory (left, hero) + Stats Panel (right, 380px)
 * 3. BOTTOM SECTION: Full-width tabbed section (History | Leaderboard)
 *
 * Spacing: gap-6 (24px) between sections
 */
export const Points = memo(function Points({
  totalPoints,
  dailyRate,
  leaderboardPosition,
  totalParticipants,
  volumePoints = 0,
  liquidityPoints = 0,
  referralPoints = 0,
  recentPointsEarned = 0,
  pointsHistory,
  leaderboardData,
  accountAddress,
  isLoading,
}: PointsProps) {
  // Track which tab is active - affects the right panel stats
  const [activeTab, setActiveTab] = useState<PointsTab>("history");

  const handleTabChange = useCallback((tab: PointsTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col",
        "gap-6",
        "mb-10"
      )}
    >
      {/* ================================================================
          SEASON TIMELINE: Full-width progress banner
          ================================================================ */}
      <SeasonTimelineBanner
        seasonStartDate={SEASON_0_START}
        seasonDurationDays={90}
        pointsPerWeek={100000}
        isLoading={isLoading}
      />

      {/* ================================================================
          MAIN SECTION: Points Inventory + Stats Panel (side by side)
          ================================================================ */}
      <div
        className={cn(
          "flex flex-col",
          "min-[1200px]:flex-row",
          "gap-6",
          "min-[1200px]:items-stretch" // Match heights on desktop
        )}
      >
        {/* POINTS INVENTORY - Left (grows to fill available space) */}
        <div className="flex-1 min-w-0 flex flex-col">
          {accountAddress ? (
            <PointsInventoryCard
              totalPoints={totalPoints}
              dailyRate={dailyRate}
              recentPointsEarned={recentPointsEarned}
              leaderboardPosition={leaderboardPosition}
              isLoading={isLoading}
            />
          ) : (
            <PointsConnectWalletBanner />
          )}
        </div>

        {/* RIGHT COLUMN - Dynamic Stats Panel (380px fixed, stretches to match left) */}
        <div
          className="flex-shrink-0 w-full min-[1200px]:w-auto"
          style={{ width: POINTS_RIGHT_COLUMN_WIDTH }}
        >
          <PointsStatsPanel
            activeTab={activeTab}
            leaderboardPosition={leaderboardPosition}
            totalParticipants={totalParticipants}
            totalPoints={totalPoints}
            dailyRate={dailyRate}
            recentPointsEarned={recentPointsEarned}
            volumePoints={volumePoints}
            liquidityPoints={liquidityPoints}
            referralPoints={referralPoints}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ================================================================
          BOTTOM SECTION: Tabbed content (History | Leaderboard)
          Full-width section with tab navigation
          ================================================================ */}
      <PointsTabsSection
        activeTab={activeTab}
        onTabChange={handleTabChange}
        pointsHistory={pointsHistory}
        leaderboardData={leaderboardData}
        currentUserPosition={leaderboardPosition}
        currentUserAddress={accountAddress}
        currentUserPoints={totalPoints}
        isLoading={isLoading}
      />
    </div>
  );
});

export default Points;
