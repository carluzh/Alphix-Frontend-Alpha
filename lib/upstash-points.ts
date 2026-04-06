/**
 * Points & Referral API Client
 *
 * Fetches all points/referral data from the backend API.
 * Backend reads from PostgreSQL — no direct Redis/Upstash access from the frontend.
 */

import { buildBackendUrlNoNetwork } from "./backend-client";

// =============================================================================
// TYPE DEFINITIONS (frontend-facing, backward-compatible)
// =============================================================================

export interface CachedUserPoints {
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
  lastUpdated: number;
}

export interface CachedHistoryEntry {
  id: string;
  type: "weekly_drop" | "referral";
  points: number;
  season?: number;
  week?: number;
  startDate?: number;
  endDate?: number;
  referralCount?: number;
}

export interface CachedLeaderboardEntry {
  rank: number;
  address: string;
  points: number;
}

export interface CachedGlobalStats {
  totalParticipants: number;
  totalPointsDistributed: number;
  currentSeason: number;
  currentWeek: number;
  seasonStartDate: number; // Unix ms
  lastUpdated: number;
}

export interface CachedReferralCode {
  code: string | null;
  usageCount: number;
  createdAt: number;
  eligible?: boolean;
  reason?: string;
}

export interface CachedRefereesData {
  referees: Array<{
    address: string;
    theirPoints: number;
    yourEarnings: number;
    theirTvlUsd: number;
    theirVolumeUsd: number;
    referredAt: number;
  }>;
  totalReferees: number;
  totalEarnings: number;
  totalReferredTvlUsd: number;
  totalReferredVolumeUsd: number;
}

export interface CachedMyReferrer {
  referrer: string;
  referralCode: string;
  joinedAt: number; // Unix ms
}

// =============================================================================
// BACKEND API HELPERS
// =============================================================================

interface BackendResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function backendGet<T>(path: string): Promise<BackendResponse<T>> {
  const url = buildBackendUrlNoNetwork(path);

  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 300 },
  });

  if (response.status === 429) {
    console.warn(`[points-api] Rate limited on ${path}`);
    return { success: false, error: "Rate limited. Please try again shortly." };
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: (errorData as { error?: string }).error || `HTTP ${response.status}`,
    };
  }

  return (await response.json()) as BackendResponse<T>;
}

// =============================================================================
// PUBLIC API FUNCTIONS (same signatures as before)
// =============================================================================

/**
 * Fetch user's points data
 */
export async function fetchUserPoints(
  address: string
): Promise<CachedUserPoints | null> {
  const res = await backendGet<{
    totalPoints: number;
    dailyRate: number;
    tvlPoints: number;
    volumePoints: number;
    referralPoints: number;
    leaderboardRank: number | null;
  }>(`/points/user/${address}`);

  if (!res.success || !res.data) return null;

  const d = res.data;
  return {
    totalPoints: d.totalPoints,
    dailyRate: d.dailyRate,
    leaderboardPosition: d.leaderboardRank,
    volumePoints: d.volumePoints,
    liquidityPoints: d.tvlPoints,
    referralPoints: d.referralPoints,
    lastUpdated: Date.now(),
  };
}

/**
 * Fetch user's points history
 */
export async function fetchUserHistory(
  address: string
): Promise<CachedHistoryEntry[]> {
  const res = await backendGet<{
    history: Array<{
      weekStartTs: number;
      weekEndTs: number;
      season: number;
      week: number;
      totalPoints: number;
      volumePoints: number;
      tvlPoints: number;
      referralPoints: number;
    }>;
    pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
  }>(`/points/history/${address}`);

  if (!res.success || !res.data) return [];

  return res.data.history.map((entry) => ({
    id: `s${entry.season}-w${entry.week}`,
    type: "weekly_drop" as const,
    points: entry.totalPoints,
    season: entry.season,
    week: entry.week,
    startDate: entry.weekStartTs * 1000,
    endDate: entry.weekEndTs * 1000,
  }));
}

/**
 * Fetch global leaderboard
 */
export async function fetchLeaderboard(): Promise<CachedLeaderboardEntry[]> {
  const res = await backendGet<{
    leaderboard: Array<{
      userAddress: string;
      totalPoints: number;
      rank: number;
    }>;
    pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
  }>("/points/leaderboard");

  if (!res.success || !res.data) return [];

  return res.data.leaderboard.map((entry) => ({
    rank: entry.rank,
    address: entry.userAddress,
    points: entry.totalPoints,
  }));
}

/**
 * Fetch global stats
 */
export async function fetchGlobalStats(): Promise<CachedGlobalStats | null> {
  const res = await backendGet<{
    totalParticipants: number;
    totalPointsDistributed: number;
    currentSeason: number;
    currentWeek: number;
    seasonStartTs: number;
    weekStartTs?: number;
    weekEndTs?: number;
  }>("/points/stats");

  if (!res.success || !res.data) return null;

  const d = res.data;
  return {
    totalParticipants: d.totalParticipants,
    totalPointsDistributed: d.totalPointsDistributed,
    currentSeason: d.currentSeason,
    currentWeek: d.currentWeek,
    seasonStartDate: d.seasonStartTs * 1000,
    lastUpdated: Date.now(),
  };
}

/**
 * Fetch user's referral code
 */
export async function fetchReferralCode(
  address: string
): Promise<CachedReferralCode | null> {
  const res = await backendGet<{
    code: string | null;
    usageCount?: number;
    createdAt?: string;
    eligible?: boolean;
    reason?: string;
  }>(`/referral/code/${address}`);

  if (!res.success || !res.data) return null;

  const d = res.data;
  return {
    code: d.code,
    usageCount: d.usageCount ?? 0,
    createdAt: d.createdAt ? new Date(d.createdAt).getTime() : 0,
    eligible: d.eligible,
    reason: d.reason,
  };
}

/**
 * Fetch user's referees data
 */
export async function fetchRefereesData(
  address: string
): Promise<CachedRefereesData | null> {
  const res = await backendGet<{
    referees: Array<{
      refereeAddress: string;
      refereePointsTotal: number;
      referrerEarnings: number;
      refereeTvlUsd?: number;
      refereeVolumeUsd?: number;
      joinedAt?: string;
    }>;
    stats: {
      totalReferees: number;
      totalEarnings: number;
      totalRefereeTvl?: number;
      totalRefereeVolume?: number;
    };
  }>(`/referral/referees/${address}`);

  if (!res.success || !res.data) return null;

  const d = res.data;
  return {
    referees: d.referees.map((r) => ({
      address: r.refereeAddress,
      theirPoints: r.refereePointsTotal,
      yourEarnings: r.referrerEarnings,
      theirTvlUsd: r.refereeTvlUsd ?? 0,
      theirVolumeUsd: r.refereeVolumeUsd ?? 0,
      referredAt: r.joinedAt ? new Date(r.joinedAt).getTime() : 0,
    })),
    totalReferees: d.stats.totalReferees,
    totalEarnings: d.stats.totalEarnings,
    totalReferredTvlUsd: d.stats.totalRefereeTvl ?? 0,
    totalReferredVolumeUsd: d.stats.totalRefereeVolume ?? 0,
  };
}

/**
 * Fetch who referred this user
 */
export async function fetchMyReferrer(
  address: string
): Promise<CachedMyReferrer | null> {
  const res = await backendGet<{
    hasReferrer?: boolean;
    referrerAddress?: string;
    referralCode?: string;
    joinedAt?: string;
  }>(`/referral/my-referrer/${address}`);

  if (!res.success || !res.data) return null;

  const d = res.data;
  if (d.hasReferrer === false || !d.referrerAddress) return null;

  return {
    referrer: d.referrerAddress,
    referralCode: d.referralCode ?? "",
    joinedAt: d.joinedAt ? new Date(d.joinedAt).getTime() : 0,
  };
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULT_USER_POINTS: CachedUserPoints = {
  totalPoints: 0,
  dailyRate: 0,
  leaderboardPosition: null,
  volumePoints: 0,
  liquidityPoints: 0,
  referralPoints: 0,
  lastUpdated: 0,
};

export const DEFAULT_GLOBAL_STATS: CachedGlobalStats = {
  totalParticipants: 0,
  totalPointsDistributed: 0,
  currentSeason: 0,
  currentWeek: 0,
  seasonStartDate: 1770854400000, // Feb 12, 2026 in ms
  lastUpdated: 0,
};

export const DEFAULT_REFEREES_DATA: CachedRefereesData = {
  referees: [],
  totalReferees: 0,
  totalEarnings: 0,
  totalReferredTvlUsd: 0,
  totalReferredVolumeUsd: 0,
};
