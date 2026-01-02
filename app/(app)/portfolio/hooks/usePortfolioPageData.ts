"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useUserPositions, useAllPrices } from "@/components/data/hooks";
import { getTokenDefinitions } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { usePortfolio } from "./usePortfolioData";
import { useWalletBalances } from "./useWalletBalances";
import type { ActivityItem } from "./useRecentActivity";

/**
 * usePortfolioPageData - Aggregates all data needed for portfolio pages
 *
 * This hook combines:
 * - User positions
 * - Wallet balances
 * - Prices
 * - Activity data
 * - Loading states
 *
 * Used by all portfolio route pages (overview, tokens, activity)
 */
export function usePortfolioPageData() {
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(
    () => getTokenDefinitions(networkMode),
    [networkMode]
  );
  const [positionsRefresh, setPositionsRefresh] = useState(0);
  const { address: accountAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();

  // User positions data
  const {
    data: userPositionsData,
    loading: isLoadingUserPositions,
  } = useUserPositions(accountAddress || "");

  // Prices data
  const { data: pricesData } = useAllPrices();

  // Portfolio data (aggregates positions + prices)
  const {
    portfolioData,
    activePositions,
    aprByPoolId,
    readiness,
    isLoadingPositions,
  } = usePortfolio(
    networkMode,
    positionsRefresh,
    userPositionsData,
    pricesData,
    isLoadingUserPositions
  );

  // Wallet balances
  const { walletBalances, isLoadingWalletBalances } = useWalletBalances({
    isConnected,
    accountAddress,
    publicClient,
    networkMode,
    tokenDefinitions,
    setPositionsRefresh,
  });

  // Activity data
  const [activityData, setActivityData] = useState<ActivityItem[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);

  useEffect(() => {
    if (accountAddress && isConnected) {
      setIsLoadingActivity(true);
      fetch(
        `/api/portfolio/activity?address=${accountAddress}&limit=50&network=${networkMode}`
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.activities) {
            setActivityData(data.activities);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingActivity(false));
    } else {
      setActivityData([]);
    }
  }, [accountAddress, isConnected, networkMode]);

  // Calculate swap count and volume for stats
  const { swapCount, totalVolumeUSD } = useMemo(() => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySwaps = activityData.filter(
      (a) => a.type === "swap" && a.timestamp * 1000 >= oneWeekAgo
    );
    return {
      swapCount: weeklySwaps.length,
      totalVolumeUSD: weeklySwaps.reduce(
        (sum, a) => sum + (a.totalUsdValue || 0),
        0
      ),
    };
  }, [activityData]);

  // Overall loading state
  const isLoading =
    isLoadingPositions || isLoadingWalletBalances || !readiness.core;

  return {
    // Connection state
    isConnected,
    accountAddress,

    // Portfolio data
    totalValue: portfolioData.totalValue,
    walletBalances,
    activePositions,
    priceMap: portfolioData.priceMap,
    priceChange24hPctMap: portfolioData.priceChange24hPctMap,
    aprByPoolId,

    // Activity data
    activities: activityData,
    swapCount,
    totalVolumeUSD,

    // Loading states
    isLoading,
    isLoadingWalletBalances,
    isLoadingActivity,
    isLoadingPositions,
  };
}
