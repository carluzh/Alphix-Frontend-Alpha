"use client";

import { useState, useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useUserPositions, useAllPrices } from "@/components/data/hooks";
import { getTokenDefinitions } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { usePortfolio } from "./usePortfolioData";
import { useWalletBalances } from "./useWalletBalances";

/**
 * usePortfolioPageData - Aggregates all data needed for portfolio pages
 *
 * This hook combines:
 * - User positions
 * - Wallet balances
 * - Prices
 * - Loading states
 *
 * Used by all portfolio route pages (overview, tokens)
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

    // Loading states
    isLoading,
    isLoadingWalletBalances,
    isLoadingPositions,
  };
}
