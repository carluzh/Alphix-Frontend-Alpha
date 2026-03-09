"use client";

import { useState, useMemo, useEffect } from "react";
import { useAccount } from "wagmi";
import { useGetUserPositionsQuery } from "@/lib/apollo/__generated__";
import { usePlatformBasedFetchPolicy } from "@/hooks/usePlatformBasedFetchPolicy";
import { usePollingIntervalByChain } from "@/hooks/usePollingIntervalByChain";
import { useOverview } from "./useOverviewData";
import { ALL_MODES } from "@/lib/chain-registry";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { fetchUserPoints, DEFAULT_USER_POINTS, type CachedUserPoints } from "@/lib/upstash-points";
import { fetchUnifiedYieldPositions } from "@/lib/liquidity/unified-yield/fetchUnifiedYieldPositions";
import { createNetworkClient } from "@/lib/viemClient";
import { chainIdForMode } from "@/lib/network-mode";
import type { NetworkMode } from "@/lib/network-mode";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";

/**
 * useOverviewPageData - Aggregates all data needed for overview pages
 *
 * This hook combines:
 * - User positions from ALL production chains (V4 + Unified Yield)
 * - Prices
 * - Points data
 * - Loading states
 */
export function useOverviewPageData() {
  const [positionsRefresh] = useState(0);
  const { address: accountAddress, isConnected } = useAccount();
  const ownerLc = (accountAddress || '').toLowerCase();
  const enabled = !!ownerLc && ownerLc.length > 0;

  const chainPollingInterval = usePollingIntervalByChain();
  const { fetchPolicy, pollInterval } = usePlatformBasedFetchPolicy({
    fetchPolicy: 'cache-and-network',
    pollInterval: chainPollingInterval * 10,
  });

  // Query positions from Base
  const { data: baseData, loading: baseLoading } = useGetUserPositionsQuery({
    variables: { chain: 'BASE', owner: ownerLc },
    skip: !enabled,
    fetchPolicy,
    pollInterval,
  });

  // Query positions from Arbitrum
  const { data: arbData, loading: arbLoading } = useGetUserPositionsQuery({
    variables: { chain: 'ARBITRUM', owner: ownerLc },
    skip: !enabled,
    fetchPolicy,
    pollInterval,
  });

  // Merge positions from both chains, tagging each with networkMode
  const userPositionsData = useMemo(() => {
    const basePositions = (baseData?.userPositions || []).map((pos: any) => ({
      ...pos,
      networkMode: 'base' as NetworkMode,
    }));
    const arbPositions = (arbData?.userPositions || []).map((pos: any) => ({
      ...pos,
      networkMode: 'arbitrum' as NetworkMode,
    }));
    return [...basePositions, ...arbPositions];
  }, [baseData, arbData]);

  const isLoadingUserPositions = (baseLoading && !baseData?.userPositions) || (arbLoading && !arbData?.userPositions);

  // Overview data (aggregates positions + prices)
  const {
    overviewData,
    activePositions,
    aprByPoolId,
    readiness,
    isLoadingPositions,
  } = useOverview(
    positionsRefresh,
    userPositionsData,
    undefined,
    isLoadingUserPositions
  );

  // Unified Yield positions — fetch from ALL production chains
  const [unifiedYieldPositions, setUnifiedYieldPositions] = useState<UnifiedYieldPosition[]>([]);
  const [isLoadingUYPositions, setIsLoadingUYPositions] = useState(false);

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setUnifiedYieldPositions([]);
      return;
    }

    let cancelled = false;
    setIsLoadingUYPositions(true);

    const fetchAllUYPositions = async () => {
      const modes = ALL_MODES;
      const results = await Promise.allSettled(
        modes.map(async (mode) => {
          const client = createNetworkClient(mode);
          const chainId = chainIdForMode(mode);
          const positions = await fetchUnifiedYieldPositions({
            userAddress: accountAddress as `0x${string}`,
            chainId,
            networkMode: mode,
            client,
          });
          // Tag each position with its networkMode
          return positions.map(p => ({ ...p, networkMode: mode }));
        })
      );

      if (!cancelled) {
        const allPositions: UnifiedYieldPosition[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') {
            allPositions.push(...result.value);
          }
        }
        setUnifiedYieldPositions(allPositions);
      }
    };

    fetchAllUYPositions().catch((error) => {
      console.warn('[useOverviewPageData] Failed to fetch Unified Yield positions:', error);
      if (!cancelled) setUnifiedYieldPositions([]);
    }).finally(() => {
      if (!cancelled) setIsLoadingUYPositions(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isConnected, accountAddress, positionsRefresh]);

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
