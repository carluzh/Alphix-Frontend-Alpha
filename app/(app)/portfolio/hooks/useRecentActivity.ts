"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

/**
 * Activity types following Uniswap's pattern
 */
export enum ActivityType {
  SWAP = "swap",
  ADD_LIQUIDITY = "add_liquidity",
  REMOVE_LIQUIDITY = "remove_liquidity",
  COLLECT_FEES = "collect_fees",
  UNKNOWN = "unknown",
}

export interface ActivityToken {
  symbol: string;
  amount: string;
  usdValue?: number;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: number; // Unix timestamp in seconds
  txHash: string;
  token0?: ActivityToken;
  token1?: ActivityToken;
  totalUsdValue?: number;
  poolId?: string;
}

export interface ActivityStats {
  swapsThisWeek: number;
  volumeThisWeekUsd: number;
}

interface UseRecentActivityReturn {
  activities: ActivityItem[];
  stats: ActivityStats;
  isLoading: boolean;
  error: Error | null;
}

/**
 * SHORTCUT NOTE:
 * This hook fetches recent user activity/transactions.
 *
 * Uniswap uses their unified activity system (useActivityData) which
 * aggregates transactions from multiple sources.
 *
 * For Alphix, you need to create an API endpoint that:
 * 1. Queries the subgraph for user transactions:
 *    - Swaps where sender/recipient is user
 *    - Mints (add liquidity) for user positions
 *    - Burns (remove liquidity) for user positions
 *    - Collects (fee claims) for user positions
 * 2. Formats them into a unified activity format
 * 3. Returns sorted by timestamp (newest first)
 *
 * Current implementation: Fetches from /api/portfolio/activity
 * TODO: Create the API endpoint
 */
export function useRecentActivity(maxItems: number = 5): UseRecentActivityReturn {
  const { address, isConnected } = useAccount();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setActivities([]);
      setIsLoading(false);
      return;
    }

    const fetchActivity = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch from API endpoint
        const response = await fetch(
          `/api/portfolio/activity?address=${address}&limit=${maxItems}`
        );

        if (!response.ok) {
          // If API doesn't exist yet, return empty
          if (response.status === 404) {
            setActivities([]);
            return;
          }
          throw new Error(`Failed to fetch activity: ${response.status}`);
        }

        const data = await response.json();

        if (data.success && Array.isArray(data.activities)) {
          setActivities(data.activities);
        } else {
          setActivities([]);
        }
      } catch (err) {
        // Don't show error for 404 - endpoint may not exist yet
        console.warn("Activity fetch error:", err);
        setActivities([]);
        setError(null); // Suppress error for now
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivity();
  }, [address, isConnected, maxItems]);

  // Calculate stats from activities
  const stats = useMemo((): ActivityStats => {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const weeklySwaps = activities.filter(
      (a) => a.type === ActivityType.SWAP && a.timestamp * 1000 >= oneWeekAgo
    );

    return {
      swapsThisWeek: weeklySwaps.length,
      volumeThisWeekUsd: weeklySwaps.reduce((sum, a) => sum + (a.totalUsdValue || 0), 0),
    };
  }, [activities]);

  return {
    activities,
    stats,
    isLoading,
    error,
  };
}

/**
 * Get display label for activity type
 */
export function getActivityTypeLabel(type: ActivityType): string {
  switch (type) {
    case ActivityType.SWAP:
      return "Swap";
    case ActivityType.ADD_LIQUIDITY:
      return "Add Liquidity";
    case ActivityType.REMOVE_LIQUIDITY:
      return "Remove Liquidity";
    case ActivityType.COLLECT_FEES:
      return "Collect Fees";
    default:
      return "Transaction";
  }
}

/**
 * Get icon name for activity type
 */
export function getActivityTypeIcon(type: ActivityType): string {
  switch (type) {
    case ActivityType.SWAP:
      return "ArrowLeftRight";
    case ActivityType.ADD_LIQUIDITY:
      return "Plus";
    case ActivityType.REMOVE_LIQUIDITY:
      return "Minus";
    case ActivityType.COLLECT_FEES:
      return "Coins";
    default:
      return "Activity";
  }
}

/**
 * Format timestamp to relative time string
 * Following Uniswap's useFormattedTime pattern
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? "1 min ago" : `${minutes} mins ago`;
  }
  return "Just now";
}

/**
 * Group activities by time period
 * Following Uniswap's formatTransactionsByDate pattern
 */
export function groupActivitiesByPeriod(activities: ActivityItem[]): {
  today: ActivityItem[];
  thisWeek: ActivityItem[];
  older: ActivityItem[];
} {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  return {
    today: activities.filter((a) => a.timestamp * 1000 >= todayStart),
    thisWeek: activities.filter(
      (a) => a.timestamp * 1000 < todayStart && a.timestamp * 1000 >= oneWeekAgo
    ),
    older: activities.filter((a) => a.timestamp * 1000 < oneWeekAgo),
  };
}
