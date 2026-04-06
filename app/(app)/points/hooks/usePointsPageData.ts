"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import * as Sentry from "@sentry/nextjs";
import {
  fetchUserPoints,
  fetchUserHistory,
  fetchLeaderboard,
  fetchGlobalStats,
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
 * User points data
 */
interface UserPointsData {
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
}

/**
 * Global stats data
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
  // Tables data
  pointsHistory: PointsHistoryEntry[];
  leaderboardData: LeaderboardEntry[];
  // Loading states
  isLoading: boolean;
  loadingStates: LoadingStates;
}

const EMPTY_USER_POINTS: UserPointsData = {
  totalPoints: DEFAULT_USER_POINTS.totalPoints,
  dailyRate: DEFAULT_USER_POINTS.dailyRate,
  leaderboardPosition: DEFAULT_USER_POINTS.leaderboardPosition,
  volumePoints: DEFAULT_USER_POINTS.volumePoints,
  liquidityPoints: DEFAULT_USER_POINTS.liquidityPoints,
  referralPoints: DEFAULT_USER_POINTS.referralPoints,
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
 * Fetches from backend API endpoints (not Upstash).
 * Parallel fetching with Promise.allSettled + granular loading states.
 */
export function usePointsPageData(): UsePointsPageDataReturn {
  const { address: accountAddress, isConnected } = useAccount();

  const [userPoints, setUserPoints] = useState<UserPointsData>(EMPTY_USER_POINTS);
  const [globalStats, setGlobalStats] = useState<GlobalStatsData>(EMPTY_GLOBAL_STATS);
  const [pointsHistory, setPointsHistory] = useState<PointsHistoryEntry[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);

  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    userPoints: false,
    globalStats: false,
    history: false,
    leaderboard: false,
  });

  const setLoading = useCallback((key: keyof LoadingStates, value: boolean) => {
    setLoadingStates((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const fetchingUserData = !!(isConnected && accountAddress);

      if (!fetchingUserData) {
        setUserPoints(EMPTY_USER_POINTS);
        setPointsHistory([]);
      }

      setLoadingStates({
        userPoints: fetchingUserData,
        globalStats: true,
        history: fetchingUserData,
        leaderboard: true,
      });

      const requests: Promise<unknown>[] = [
        fetchGlobalStats(),
        fetchLeaderboard(),
      ];

      if (fetchingUserData) {
        requests.push(
          fetchUserPoints(accountAddress),
          fetchUserHistory(accountAddress)
        );
      }

      const results = await Promise.allSettled(requests);

      if (cancelled) return;

      const [globalStatsResult, leaderboardResult] = results;

      // Handle global stats
      if (globalStatsResult.status === "fulfilled") {
        const data = globalStatsResult.value as Awaited<ReturnType<typeof fetchGlobalStats>>;
        if (data) {
          setGlobalStats({
            totalParticipants: data.totalParticipants,
            currentSeason: data.currentSeason,
            currentWeek: data.currentWeek,
            seasonStartDate: data.seasonStartDate,
          });
        }
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

      // Handle user-specific data
      if (fetchingUserData) {
        const userPointsResult = results[2];
        const historyResult = results[3];

        if (userPointsResult.status === "fulfilled") {
          const data = userPointsResult.value as Awaited<ReturnType<typeof fetchUserPoints>>;
          if (data) {
            setUserPoints({
              totalPoints: data.totalPoints,
              dailyRate: data.dailyRate,
              leaderboardPosition: data.leaderboardPosition,
              volumePoints: data.volumePoints,
              liquidityPoints: data.liquidityPoints,
              referralPoints: data.referralPoints,
            });
          }
        } else {
          Sentry.captureException(userPointsResult.reason, {
            tags: { operation: "points_fetch_user_points" },
            extra: { address: accountAddress },
          });
        }
        setLoading("userPoints", false);

        if (historyResult.status === "fulfilled") {
          const data = historyResult.value as Awaited<ReturnType<typeof fetchUserHistory>>;
          setPointsHistory(
            data.map((entry) => ({
              id: entry.id,
              type: entry.type,
              points: entry.points,
              season: entry.season,
              week: entry.week,
              startDate: entry.startDate,
              endDate: entry.endDate,
              referralCount: entry.referralCount,
              timestamp: entry.type === "referral" ? entry.startDate : undefined,
            }))
          );
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

  const isLoading = Object.values(loadingStates).some(Boolean);

  return {
    isConnected,
    accountAddress,
    totalPoints: userPoints.totalPoints,
    dailyRate: userPoints.dailyRate,
    leaderboardPosition: userPoints.leaderboardPosition,
    totalParticipants: globalStats.totalParticipants,
    currentSeason: globalStats.currentSeason,
    currentWeek: globalStats.currentWeek,
    seasonStartDate: new Date(globalStats.seasonStartDate),
    volumePoints: userPoints.volumePoints,
    liquidityPoints: userPoints.liquidityPoints,
    referralPoints: userPoints.referralPoints,
    pointsHistory,
    leaderboardData,
    isLoading,
    loadingStates,
  };
}
