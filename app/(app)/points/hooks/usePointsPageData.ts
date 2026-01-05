"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import * as Sentry from "@sentry/nextjs";

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

// Time constants for mock data
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SEASON_START = new Date(2024, 9, 3, 2, 0, 0, 0).getTime(); // Oct 3, 2024, 02:00

/**
 * Mock data generators - Replace with actual API calls
 */
async function fetchUserPoints(address: string): Promise<UserPointsData> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    totalPoints: 1022.7923,
    dailyRate: 45.32,
    leaderboardPosition: 127,
    volumePoints: 125.45,
    liquidityPoints: 872.34,
    referralPoints: 25.0,
    recentPointsEarned: 317.65,
  };
}

async function fetchGlobalStats(): Promise<GlobalStatsData> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { totalParticipants: 2847 };
}

async function fetchPointsHistory(_address: string): Promise<PointsHistoryEntry[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return [
    { id: "1", type: "weekly_drop", points: 317.65, season: 0, week: 8, startDate: SEASON_START + 7 * WEEK_MS, endDate: SEASON_START + 8 * WEEK_MS },
    { id: "2", type: "weekly_drop", points: 284.12, season: 0, week: 7, startDate: SEASON_START + 6 * WEEK_MS, endDate: SEASON_START + 7 * WEEK_MS },
    { id: "3", type: "weekly_drop", points: 198.45, season: 0, week: 6, startDate: SEASON_START + 5 * WEEK_MS, endDate: SEASON_START + 6 * WEEK_MS },
    { id: "4", type: "referral", points: 25.0, referralCount: 2, timestamp: SEASON_START + 5 * WEEK_MS + 3 * DAY_MS },
    { id: "5", type: "weekly_drop", points: 156.78, season: 0, week: 5, startDate: SEASON_START + 4 * WEEK_MS, endDate: SEASON_START + 5 * WEEK_MS },
    { id: "6", type: "weekly_drop", points: 12.45, season: 0, week: 4, startDate: SEASON_START + 3 * WEEK_MS, endDate: SEASON_START + 4 * WEEK_MS },
    { id: "7", type: "weekly_drop", points: 3.28, season: 0, week: 3, startDate: SEASON_START + 2 * WEEK_MS, endDate: SEASON_START + 3 * WEEK_MS },
    { id: "8", type: "weekly_drop", points: 1.89, season: 0, week: 2, startDate: SEASON_START + 1 * WEEK_MS, endDate: SEASON_START + 2 * WEEK_MS },
    { id: "9", type: "weekly_drop", points: 0.54, season: 0, week: 1, startDate: SEASON_START, endDate: SEASON_START + 1 * WEEK_MS },
    { id: "10", type: "referral", points: 15.0, referralCount: 1, timestamp: SEASON_START + 2 * WEEK_MS + 1 * DAY_MS },
    { id: "11", type: "weekly_drop", points: 412.33, season: 0, week: 9, startDate: SEASON_START + 8 * WEEK_MS, endDate: SEASON_START + 9 * WEEK_MS },
    { id: "12", type: "weekly_drop", points: 523.87, season: 0, week: 10, startDate: SEASON_START + 9 * WEEK_MS, endDate: SEASON_START + 10 * WEEK_MS },
    { id: "13", type: "referral", points: 8.5, referralCount: 1, timestamp: SEASON_START + 9 * WEEK_MS + 2 * DAY_MS },
    { id: "14", type: "weekly_drop", points: 678.21, season: 0, week: 11, startDate: SEASON_START + 10 * WEEK_MS, endDate: SEASON_START + 11 * WEEK_MS },
    { id: "15", type: "weekly_drop", points: 445.99, season: 0, week: 12, startDate: SEASON_START + 11 * WEEK_MS, endDate: SEASON_START + 12 * WEEK_MS },
  ];
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return [
    { rank: 1, address: "0x1234567890abcdef1234567890abcdef12345678", points: 15847.32 },
    { rank: 2, address: "0xabcdef1234567890abcdef1234567890abcdef12", points: 12453.18 },
    { rank: 3, address: "0x9876543210fedcba9876543210fedcba98765432", points: 9821.45 },
    { rank: 4, address: "0xfedcba9876543210fedcba9876543210fedcba98", points: 7654.21 },
    { rank: 5, address: "0x5555555555555555555555555555555555555555", points: 6432.89 },
    { rank: 6, address: "0x6666666666666666666666666666666666666666", points: 5218.67 },
    { rank: 7, address: "0x7777777777777777777777777777777777777777", points: 4102.33 },
    { rank: 8, address: "0x8888888888888888888888888888888888888888", points: 3567.91 },
    { rank: 9, address: "0x9999999999999999999999999999999999999999", points: 2845.12 },
    { rank: 10, address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", points: 2134.78 },
    { rank: 11, address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", points: 1987.45 },
    { rank: 12, address: "0xcccccccccccccccccccccccccccccccccccccccc", points: 1856.23 },
    { rank: 13, address: "0xdddddddddddddddddddddddddddddddddddddddd", points: 1723.67 },
    { rank: 14, address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", points: 1598.34 },
    { rank: 15, address: "0xffffffffffffffffffffffffffffffffffffffff", points: 1456.89 },
    { rank: 16, address: "0x1111222233334444555566667777888899990000", points: 1345.12 },
    { rank: 17, address: "0x2222333344445555666677778888999900001111", points: 1234.56 },
    { rank: 18, address: "0x3333444455556666777788889999000011112222", points: 1123.78 },
    { rank: 19, address: "0x4444555566667777888899990000111122223333", points: 1098.45 },
    { rank: 20, address: "0x5556667778889990001112223334445556667778", points: 1067.23 },
    { rank: 21, address: "0x6667778889990001112223334445556667778889", points: 1045.67 },
    { rank: 22, address: "0x7778889990001112223334445556667778889990", points: 1023.89 },
    { rank: 23, address: "0x8889990001112223334445556667778889990001", points: 998.34 },
    { rank: 24, address: "0x9990001112223334445556667778889990001112", points: 967.12 },
  ];
}

/**
 * Default empty states
 */
const DEFAULT_USER_POINTS: UserPointsData = {
  totalPoints: 0,
  dailyRate: 0,
  leaderboardPosition: null,
  volumePoints: 0,
  liquidityPoints: 0,
  referralPoints: 0,
  recentPointsEarned: 0,
};

const DEFAULT_GLOBAL_STATS: GlobalStatsData = {
  totalParticipants: 0,
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
  const [userPoints, setUserPoints] = useState<UserPointsData>(DEFAULT_USER_POINTS);
  const [globalStats, setGlobalStats] = useState<GlobalStatsData>(DEFAULT_GLOBAL_STATS);
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
        setUserPoints(DEFAULT_USER_POINTS);
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
