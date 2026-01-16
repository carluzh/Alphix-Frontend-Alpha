"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { useUserPositions, useAllPrices } from "@/lib/apollo/hooks";
import { getTokenDefinitions } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useOverview } from "./useOverviewData";
import { useWalletBalances } from "./useWalletBalances";
import { fetchUserPoints, DEFAULT_USER_POINTS, type CachedUserPoints } from "@/lib/upstash-points";

/**
 * useOverviewPageData - Aggregates all data needed for overview pages
 *
 * This hook combines:
 * - User positions
 * - Wallet balances
 * - Prices
 * - Loading states
 *
 * Used by all overview route pages (overview, tokens)
 */
export function useOverviewPageData() {
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(
    () => getTokenDefinitions(networkMode),
    [networkMode]
  );
  const [positionsRefresh, setPositionsRefresh] = useState(0);
  const { address: accountAddress, isConnected } = useAccount();

  // User positions data
  const {
    data: userPositionsData,
    loading: isLoadingUserPositions,
  } = useUserPositions(accountAddress || "");

  // Prices data
  const { data: pricesData } = useAllPrices();

  // Overview data (aggregates positions + prices)
  const {
    overviewData,
    activePositions,
    aprByPoolId,
    readiness,
    isLoadingPositions,
  } = useOverview(
    networkMode,
    positionsRefresh,
    userPositionsData,
    pricesData,
    isLoadingUserPositions
  );

  // Wallet balances (uses wagmi hooks with batched multicall)
  const { walletBalances, isLoadingWalletBalances } = useWalletBalances({
    isConnected,
    accountAddress,
    networkMode,
    tokenDefinitions,
    setPositionsRefresh,
  });

  // Points data (fetched from Upstash)
  const [pointsData, setPointsData] = useState<CachedUserPoints>(DEFAULT_USER_POINTS);
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setPointsData(DEFAULT_USER_POINTS);
      return;
    }

    let cancelled = false;
    setIsLoadingPoints(true);

    fetchUserPoints(accountAddress)
      .then((data) => {
        if (!cancelled) {
          setPointsData(data ?? DEFAULT_USER_POINTS);
        }
      })
      .catch((err) => {
        console.error("[useOverviewPageData] Error fetching points:", err);
        if (!cancelled) {
          setPointsData(DEFAULT_USER_POINTS);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPoints(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, accountAddress]);

  // Overall loading state
  const isLoading =
    isLoadingPositions || isLoadingWalletBalances || isLoadingPoints || !readiness.core;

  return {
    // Connection state
    isConnected,
    accountAddress,

    // Overview data
    totalValue: overviewData.totalValue,
    walletBalances,
    activePositions,
    priceMap: overviewData.priceMap,
    priceChange24hPctMap: overviewData.priceChange24hPctMap,
    aprByPoolId,

    // Points data
    totalPoints: pointsData.totalPoints,
    dailyPoints: pointsData.dailyRate,
    leaderboardPosition: pointsData.leaderboardPosition,

    // Loading states
    isLoading,
    isLoadingWalletBalances,
    isLoadingPositions,
    isLoadingPoints,
  };
}
