"use client";

import { useState, useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useUserPositions, useAllPrices } from "@/components/data/hooks";
import { getTokenDefinitions } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useOverview } from "./useOverviewData";
import { useWalletBalances } from "./useWalletBalances";

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
  const publicClient = usePublicClient();

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

  // Wallet balances
  const { walletBalances, isLoadingWalletBalances } = useWalletBalances({
    isConnected,
    accountAddress,
    publicClient,
    networkMode,
    tokenDefinitions,
    setPositionsRefresh,
  });

  // Overall loading state
  const isLoading =
    isLoadingPositions || isLoadingWalletBalances || !readiness.core;

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

    // Loading states
    isLoading,
    isLoadingWalletBalances,
    isLoadingPositions,
  };
}
