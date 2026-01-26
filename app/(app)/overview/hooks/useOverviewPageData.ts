"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { useUserPositions, useAllPrices } from "@/lib/apollo/hooks";
import { useNetwork } from "@/lib/network-context";
import { useOverview } from "./useOverviewData";
import { fetchUserPoints, DEFAULT_USER_POINTS, type CachedUserPoints } from "@/lib/upstash-points";
import { fetchUnifiedYieldPositions } from "@/lib/liquidity/unified-yield/fetchUnifiedYieldPositions";
import { createNetworkClient } from "@/lib/viemClient";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";

/**
 * useOverviewPageData - Aggregates all data needed for overview pages
 *
 * This hook combines:
 * - User positions (V4 + Unified Yield)
 * - Prices
 * - Points data
 * - Loading states
 */
export function useOverviewPageData() {
  const { networkMode } = useNetwork();
  const [positionsRefresh] = useState(0);
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

  // Unified Yield positions (fetched directly from Hook contracts)
  const [unifiedYieldPositions, setUnifiedYieldPositions] = useState<UnifiedYieldPosition[]>([]);
  const [isLoadingUYPositions, setIsLoadingUYPositions] = useState(false);

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setUnifiedYieldPositions([]);
      return;
    }

    let cancelled = false;
    setIsLoadingUYPositions(true);

    const fetchUYPositions = async () => {
      try {
        const client = createNetworkClient(networkMode);
        const chainId = networkMode === 'mainnet' ? 8453 : 84532;
        const positions = await fetchUnifiedYieldPositions({
          userAddress: accountAddress as `0x${string}`,
          chainId,
          networkMode,
          client,
        });
        if (!cancelled) {
          setUnifiedYieldPositions(positions);
        }
      } catch (error) {
        console.warn('[useOverviewPageData] Failed to fetch Unified Yield positions:', error);
        if (!cancelled) {
          setUnifiedYieldPositions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingUYPositions(false);
        }
      }
    };

    fetchUYPositions();

    return () => {
      cancelled = true;
    };
  }, [isConnected, accountAddress, networkMode, positionsRefresh]);

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
    isLoadingPositions || isLoadingPoints || isLoadingUYPositions || !readiness.core;

  return {
    // Connection state
    isConnected,
    accountAddress,

    // Overview data
    totalValue: overviewData.totalValue,
    activePositions,
    unifiedYieldPositions,
    priceMap: overviewData.priceMap,
    priceChange24hPctMap: overviewData.priceChange24hPctMap,
    aprByPoolId,

    // Points data
    totalPoints: pointsData.totalPoints,
    dailyPoints: pointsData.dailyRate,
    leaderboardPosition: pointsData.leaderboardPosition,

    // Loading states
    isLoading,
    isLoadingPositions,
    isLoadingUYPositions,
    isLoadingPoints,
  };
}
