"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { useUserPositions } from "@/lib/apollo/hooks";
import { useNetwork } from "@/lib/network-context";
import { useOverview } from "./useOverviewData";
import { useTokenPrices } from "@/hooks/useTokenPrices";
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

  // Overview data (aggregates positions + prices)
  // Prices are fetched internally via batchQuotePrices() — no need for useAllPrices
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
    undefined,
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

  // Unified priceMap: extract token symbols from ALL position types (V4 + Unified Yield)
  // V4 positions may be empty (subgraph returns []) while UY positions have data,
  // so we must include UY symbols to ensure ETH/etc get priced.
  const allTokenSymbols = useMemo(() => {
    const symbols = new Set<string>();
    // V4 positions
    (userPositionsData || []).forEach((pos: any) => {
      if (pos.token0?.symbol) symbols.add(pos.token0.symbol);
      if (pos.token1?.symbol) symbols.add(pos.token1.symbol);
    });
    // Unified Yield positions
    unifiedYieldPositions.forEach((pos) => {
      if (pos.token0Symbol) symbols.add(pos.token0Symbol);
      if (pos.token1Symbol) symbols.add(pos.token1Symbol);
    });
    return Array.from(symbols);
  }, [userPositionsData, unifiedYieldPositions]);

  const { prices: priceMap } = useTokenPrices(allTokenSymbols, { pollInterval: 60_000 });

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
    priceMap,
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
