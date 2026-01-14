"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import * as Sentry from "@sentry/nextjs";
import {
  fetchUserPoints as fetchUserPointsFromUpstash,
  fetchUserHistory,
  fetchLeaderboard as fetchLeaderboardFromUpstash,
  fetchGlobalStats as fetchGlobalStatsFromUpstash,
  DEFAULT_USER_POINTS,
  DEFAULT_GLOBAL_STATS,
} from "@/lib/upstash-points";

/**
 * Points history entry
 */
export interface PointsHistoryEntry {
  id: string;
  type: "weekly_drop" | "referral";
  points: number;
  // For weekly drops
  season?: number;
  week?: number;
  startDate?: number;
  endDate?: number;
  // For referrals
  referralCount?: number;
  timestamp?: number; // Single date for referrals
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  address: string;
  points: number;
  isCurrentUser?: boolean;
}

/**
 * User points data from API
 */
interface UserPointsData {
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
  recentPointsEarned: number;
}

/**
 * Global stats data from API
 */
interface GlobalStatsData {
  totalParticipants: number;
  currentSeason: number;
  currentWeek: number;
  seasonStartDate: number; // Unix timestamp in ms
}

/**
 * Loading states for granular UI feedback
 */
export interface LoadingStates {
  userPoints: boolean;
  globalStats: boolean;
  history: boolean;
  leaderboard: boolean;
}

/**
 * Return type for usePointsPageData hook
 */
export interface UsePointsPageDataReturn {
  // Connection state
  isConnected: boolean;
  accountAddress: string | undefined;
  // Points data
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  totalParticipants: number;
  // Season data
  currentSeason: number;
  currentWeek: number;
  seasonStartDate: Date;
  // Points breakdown
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
  recentPointsEarned: number;
  // Tables data
  pointsHistory: PointsHistoryEntry[];
  leaderboardData: LeaderboardEntry[];
  // Loading states
  isLoading: boolean;
  loadingStates: LoadingStates;
}

/**
 * Fetch user points from Upstash and transform to internal format
 */
async function fetchUserPoints(address: string): Promise<UserPointsData> {
  const data = await fetchUserPointsFromUpstash(address);
  if (!data) {
    return {
      totalPoints: DEFAULT_USER_POINTS.totalPoints,
      dailyRate: DEFAULT_USER_POINTS.dailyRate,
      leaderboardPosition: DEFAULT_USER_POINTS.leaderboardPosition,
      volumePoints: DEFAULT_USER_POINTS.volumePoints,
      liquidityPoints: DEFAULT_USER_POINTS.liquidityPoints,
      referralPoints: DEFAULT_USER_POINTS.referralPoints,
      recentPointsEarned: DEFAULT_USER_POINTS.recentPointsEarned,
    };
  }
  return {
    totalPoints: data.totalPoints,
    dailyRate: data.dailyRate,
    leaderboardPosition: data.leaderboardPosition,
    volumePoints: data.volumePoints,
    liquidityPoints: data.liquidityPoints,
    referralPoints: data.referralPoints,
    recentPointsEarned: data.recentPointsEarned,
  };
}

/**
 * Fetch global stats from Upstash
 */
async function fetchGlobalStats(): Promise<GlobalStatsData> {
  const data = await fetchGlobalStatsFromUpstash();
  return {
    totalParticipants: data?.totalParticipants ?? DEFAULT_GLOBAL_STATS.totalParticipants,
    currentSeason: data?.currentSeason ?? DEFAULT_GLOBAL_STATS.currentSeason,
    currentWeek: data?.currentWeek ?? DEFAULT_GLOBAL_STATS.currentWeek,
    seasonStartDate: data?.seasonStartDate ?? DEFAULT_GLOBAL_STATS.seasonStartDate,
  };
}

/**
 * Fetch points history from Upstash and transform to internal format
 */
async function fetchPointsHistory(address: string): Promise<PointsHistoryEntry[]> {
  const data = await fetchUserHistory(address);
  return data.map((entry) => ({
    id: entry.id,
    type: entry.type,
    points: entry.points,
    season: entry.season,
    week: entry.week,
    startDate: entry.startDate,
    endDate: entry.endDate,
    referralCount: entry.referralCount,
    // For referral entries, use startDate as timestamp
    timestamp: entry.type === "referral" ? entry.startDate : undefined,
  }));
}

/**
 * Fetch leaderboard from Upstash
 */
async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = await fetchLeaderboardFromUpstash();
  return data.map((entry) => ({
    rank: entry.rank,
    address: entry.address,
    points: entry.points,
  }));
}

/**
 * Default empty states (using constants from upstash-points)
 */
const EMPTY_USER_POINTS: UserPointsData = {
  totalPoints: DEFAULT_USER_POINTS.totalPoints,
  dailyRate: DEFAULT_USER_POINTS.dailyRate,
  leaderboardPosition: DEFAULT_USER_POINTS.leaderboardPosition,
  volumePoints: DEFAULT_USER_POINTS.volumePoints,
  liquidityPoints: DEFAULT_USER_POINTS.liquidityPoints,
  referralPoints: DEFAULT_USER_POINTS.referralPoints,
  recentPointsEarned: DEFAULT_USER_POINTS.recentPointsEarned,
};

const EMPTY_GLOBAL_STATS: GlobalStatsData = {
  totalParticipants: DEFAULT_GLOBAL_STATS.totalParticipants,
  currentSeason: DEFAULT_GLOBAL_STATS.currentSeason,
  currentWeek: DEFAULT_GLOBAL_STATS.currentWeek,
  seasonStartDate: DEFAULT_GLOBAL_STATS.seasonStartDate,
};

/**
 * usePointsPageData - Aggregates all data needed for the points page
 *
 * Architecture follows Uniswap patterns:
 * - Separate state for each data category
 * - Granular loading states for progressive UI
 * - Parallel fetching with Promise.allSettled
 * - Clean separation between fetching and derived values
 */
export function usePointsPageData(): UsePointsPageDataReturn {
  const { address: accountAddress, isConnected } = useAccount();

  // Separate state for each data category (Uniswap pattern)
  const [userPoints, setUserPoints] = useState<UserPointsData>(EMPTY_USER_POINTS);
  const [globalStats, setGlobalStats] = useState<GlobalStatsData>(EMPTY_GLOBAL_STATS);
  const [pointsHistory, setPointsHistory] = useState<PointsHistoryEntry[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);

  // Granular loading states (Uniswap pattern)
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    userPoints: false,
    globalStats: false,
    history: false,
    leaderboard: false,
  });

  // Helper to update specific loading state
  const setLoading = useCallback((key: keyof LoadingStates, value: boolean) => {
    setLoadingStates((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Single consolidated effect - fetches all data in parallel
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      // Always fetch public data (globalStats, leaderboard)
      // Only fetch user data when connected
      const fetchingUserData = !!(isConnected && accountAddress);

      // Reset user-specific data when disconnected
      if (!fetchingUserData) {
        setUserPoints(EMPTY_USER_POINTS);
        setPointsHistory([]);
      }

      // Set loading states for what we're fetching
      setLoadingStates({
        userPoints: fetchingUserData,
        globalStats: true,
        history: fetchingUserData,
        leaderboard: true,
      });

      // Build request array conditionally
      const requests: Promise<unknown>[] = [
        fetchGlobalStats(),
        fetchLeaderboard(),
      ];

      // Add user-specific requests if connected
      if (fetchingUserData) {
        requests.push(
          fetchUserPoints(accountAddress),
          fetchPointsHistory(accountAddress)
        );
      }

      // Parallel fetch with independent error handling
      const results = await Promise.allSettled(requests);

      if (cancelled) return;

      // Process results - indices depend on whether user data was fetched
      const [globalStatsResult, leaderboardResult] = results;

      // Handle global stats
      if (globalStatsResult.status === "fulfilled") {
        setGlobalStats(globalStatsResult.value as GlobalStatsData);
      } else {
        Sentry.captureException(globalStatsResult.reason, {
          tags: { operation: "points_fetch_global_stats" },
        });
      }
      setLoading("globalStats", false);

      // Handle leaderboard
      if (leaderboardResult.status === "fulfilled") {
        setLeaderboardData(leaderboardResult.value as LeaderboardEntry[]);
      } else {
        Sentry.captureException(leaderboardResult.reason, {
          tags: { operation: "points_fetch_leaderboard" },
        });
      }
      setLoading("leaderboard", false);

      // Handle user-specific data if fetched
      if (fetchingUserData) {
        const userPointsResult = results[2];
        const historyResult = results[3];

        if (userPointsResult.status === "fulfilled") {
          setUserPoints(userPointsResult.value as UserPointsData);
        } else {
          Sentry.captureException(userPointsResult.reason, {
            tags: { operation: "points_fetch_user_points" },
            extra: { address: accountAddress },
          });
        }
        setLoading("userPoints", false);

        if (historyResult.status === "fulfilled") {
          setPointsHistory(historyResult.value as PointsHistoryEntry[]);
        } else {
          Sentry.captureException(historyResult.reason, {
            tags: { operation: "points_fetch_history" },
            extra: { address: accountAddress },
          });
        }
        setLoading("history", false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [isConnected, accountAddress, setLoading]);

  // Computed overall loading state (includes all categories)
  const isLoading = Object.values(loadingStates).some(Boolean);

  return {
    // Connection state
    isConnected,
    accountAddress,

    // Points data (flattened for backward compatibility)
    totalPoints: userPoints.totalPoints,
    dailyRate: userPoints.dailyRate,
    leaderboardPosition: userPoints.leaderboardPosition,
    totalParticipants: globalStats.totalParticipants,

    // Season data
    currentSeason: globalStats.currentSeason,
    currentWeek: globalStats.currentWeek,
    seasonStartDate: new Date(globalStats.seasonStartDate),

    // Points breakdown
    volumePoints: userPoints.volumePoints,
    liquidityPoints: userPoints.liquidityPoints,
    referralPoints: userPoints.referralPoints,
    recentPointsEarned: userPoints.recentPointsEarned,

    // Tables data
    pointsHistory,
    leaderboardData,

    // Loading states (granular + overall)
    isLoading,
    loadingStates,
  };
}
