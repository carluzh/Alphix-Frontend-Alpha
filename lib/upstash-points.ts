/**
 * Upstash Points Client
 *
 * Read-only client for fetching points data directly from Upstash Redis.
 * This eliminates backend load for read operations.
 *
 * All data is pushed to Upstash weekly by the backend computation script.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const UPSTASH_REST_URL = process.env.NEXT_PUBLIC_UPSTASH_REDIS_REST_URL;
const UPSTASH_REST_TOKEN = process.env.NEXT_PUBLIC_UPSTASH_REDIS_REST_TOKEN;

/**
 * Check if Upstash is configured
 */
export function isUpstashConfigured(): boolean {
  return !!(UPSTASH_REST_URL && UPSTASH_REST_TOKEN);
}

// =============================================================================
// CACHE KEYS (must match backend)
// =============================================================================

const CACHE_KEYS = {
  USER_POINTS: (address: string) => `points:user:${address.toLowerCase()}`,
  USER_HISTORY: (address: string) => `points:history:${address.toLowerCase()}`,
  LEADERBOARD: 'points:leaderboard',
  GLOBAL_STATS: 'points:stats',
  REFERRAL_CODE: (address: string) => `referral:code:${address.toLowerCase()}`,
  REFERRAL_REFEREES: (address: string) => `referral:referees:${address.toLowerCase()}`,
  REFERRAL_MY_REFERRER: (address: string) => `referral:referrer:${address.toLowerCase()}`,
} as const;

// =============================================================================
// TYPE DEFINITIONS (must match backend cache.ts)
// =============================================================================

export interface CachedUserPoints {
  totalPoints: number;
  dailyRate: number;
  leaderboardPosition: number | null;
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
  recentPointsEarned: number;
  lastUpdated: number;
}

export interface CachedHistoryEntry {
  id: string;
  type: 'weekly_drop' | 'referral';
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
  seasonStartDate: number;
  lastUpdated: number;
}

export interface CachedReferralCode {
  code: string;
  usageCount: number;
  createdAt: number;
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
  joinedAt: number;
}

// =============================================================================
// UPSTASH REST API CLIENT
// =============================================================================

interface UpstashResponse<T> {
  result: T | null;
  error?: string;
}

/**
 * Fetch a value from Upstash Redis via REST API
 */
async function upstashGet<T>(key: string): Promise<T | null> {
  if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(`${UPSTASH_REST_URL}/get/${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${UPSTASH_REST_TOKEN}`,
      },
      // Cache for 5 minutes on the edge
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as UpstashResponse<string>;

    if (data.error || data.result === null) {
      return null;
    }

    // Upstash returns JSON as string, need to parse
    try {
      return JSON.parse(data.result) as T;
    } catch {
      // If it's not JSON, return as-is (for simple strings)
      return data.result as unknown as T;
    }
  } catch {
    return null;
  }
}

// =============================================================================
// PUBLIC API FUNCTIONS
// =============================================================================

/**
 * Fetch user's points data
 */
export async function fetchUserPoints(address: string): Promise<CachedUserPoints | null> {
  return upstashGet<CachedUserPoints>(CACHE_KEYS.USER_POINTS(address));
}

/**
 * Fetch user's points history
 */
export async function fetchUserHistory(address: string): Promise<CachedHistoryEntry[]> {
  const result = await upstashGet<CachedHistoryEntry[]>(CACHE_KEYS.USER_HISTORY(address));
  return result || [];
}

/**
 * Fetch global leaderboard
 */
export async function fetchLeaderboard(): Promise<CachedLeaderboardEntry[]> {
  const result = await upstashGet<CachedLeaderboardEntry[]>(CACHE_KEYS.LEADERBOARD);
  return result || [];
}

/**
 * Fetch global stats
 */
export async function fetchGlobalStats(): Promise<CachedGlobalStats | null> {
  return upstashGet<CachedGlobalStats>(CACHE_KEYS.GLOBAL_STATS);
}

/**
 * Fetch user's referral code
 */
export async function fetchReferralCode(address: string): Promise<CachedReferralCode | null> {
  return upstashGet<CachedReferralCode>(CACHE_KEYS.REFERRAL_CODE(address));
}

/**
 * Fetch user's referees data
 */
export async function fetchRefereesData(address: string): Promise<CachedRefereesData | null> {
  return upstashGet<CachedRefereesData>(CACHE_KEYS.REFERRAL_REFEREES(address));
}

/**
 * Fetch who referred this user
 */
export async function fetchMyReferrer(address: string): Promise<CachedMyReferrer | null> {
  return upstashGet<CachedMyReferrer>(CACHE_KEYS.REFERRAL_MY_REFERRER(address));
}

// =============================================================================
// DEFAULT VALUES (for when data doesn't exist yet)
// =============================================================================

export const DEFAULT_USER_POINTS: CachedUserPoints = {
  totalPoints: 0,
  dailyRate: 0,
  leaderboardPosition: null,
  volumePoints: 0,
  liquidityPoints: 0,
  referralPoints: 0,
  recentPointsEarned: 0,
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
