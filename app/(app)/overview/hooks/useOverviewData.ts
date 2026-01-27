"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { getAllPools, getChainId } from "@/lib/pools-config";
import { batchQuotePrices } from "@/lib/swap/quote-prices";

export interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

export interface OverviewData {
  totalValue: number;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error?: string;
  priceMap: Record<string, number>;
  pnl24hPct: number;
  priceChange24hPctMap: Record<string, number>;
}

export type Readiness = {
  core: boolean;
  prices: boolean;
  apr: boolean;
};

// Greyscale colors for token allocation visualization
const TOKEN_COLORS = [
  "hsl(0 0% 30%)",
  "hsl(0 0% 40%)",
  "hsl(0 0% 60%)",
  "hsl(0 0% 80%)",
  "hsl(0 0% 95%)",
];

/**
 * Hook to aggregate overview data from user positions
 * Adapted from Uniswap's portfolio data fetching pattern
 */
export function useOverviewData(
  networkMode: "mainnet" | "testnet",
  refreshKey: number = 0,
  userPositionsData?: any[],
  pricesData?: any
): OverviewData {
  const { address: accountAddress, isConnected } = useAccount();
  const [overviewData, setOverviewData] = useState<OverviewData>({
    totalValue: 0,
    tokenBalances: [],
    isLoading: true,
    error: undefined,
    priceMap: {},
    pnl24hPct: 0,
    priceChange24hPctMap: {},
  });

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setOverviewData({
        totalValue: 0,
        tokenBalances: [],
        isLoading: false,
        error: undefined,
        priceMap: {},
        pnl24hPct: 0,
        priceChange24hPctMap: {},
      });
      return;
    }

    const fetchOverviewData = async (positionsData: any[], priceData: any) => {
      try {
        setOverviewData((prev) => ({ ...prev, isLoading: true, error: undefined }));

        // 1. Filter to configured pools only
        const positionsRaw = positionsData || [];
        let positions = Array.isArray(positionsRaw) ? positionsRaw : [];
        try {
          const pools = getAllPools(networkMode);
          const allowedIds = new Set(
            (pools || []).map((p: any) => String(p?.subgraphId || "").toLowerCase())
          );
          positions = positions.filter((pos: any) => {
            const pid = String(pos?.poolId || "").toLowerCase();
            return pid && allowedIds.has(pid);
          });
        } catch {}

        // 2. Aggregate token balances from positions
        const tokenBalanceMap = new Map<string, number>();
        if (Array.isArray(positions)) {
          positions.forEach((position: any) => {
            const t0 = position.token0?.symbol;
            const a0 = parseFloat(position.token0?.amount || "0");
            if (t0 && a0 > 0) tokenBalanceMap.set(t0, (tokenBalanceMap.get(t0) || 0) + a0);

            const t1 = position.token1?.symbol;
            const a1 = parseFloat(position.token1?.amount || "0");
            if (t1 && a1 > 0) tokenBalanceMap.set(t1, (tokenBalanceMap.get(t1) || 0) + a1);
          });
        }

        // 3. Resolve prices (batchQuotePrices auto-detects client/server for caching)
        const tokenSymbols = Array.from(tokenBalanceMap.keys());
        const priceMap = new Map<string, number>();
        const chainId = getChainId(networkMode);
        try {
          const batch = await batchQuotePrices(tokenSymbols, chainId, networkMode);
          tokenSymbols.forEach((symbol) => {
            const px = batch[symbol];
            if (typeof px === "number" && px > 0) priceMap.set(symbol, px);
          });
        } catch {}

        // 4. Create token balances with USD values and colors
        const tokenBalances: TokenBalance[] = Array.from(tokenBalanceMap.entries())
          .map(([symbol, balance]) => ({
            symbol,
            balance,
            usdValue: balance * (priceMap.get(symbol) || 0),
            color: "",
          }))
          .filter((token) => token.usdValue > 0.01)
          .sort((a, b) => b.usdValue - a.usdValue);

        // Assign colors after sorting
        tokenBalances.forEach((token, index) => {
          token.color = TOKEN_COLORS[index % TOKEN_COLORS.length];
        });

        const totalValue = tokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

        // 5. Compute portfolio 24h PnL %
        let deltaNowUSD = 0;
        if (totalValue > 0) {
          tokenBalances.forEach((tb) => {
            const s = String(tb.symbol || "").toUpperCase();
            const base = s.includes("BTC")
              ? "BTC"
              : s.includes("ETH")
              ? "ETH"
              : s.includes("USDC")
              ? "USDC"
              : s.includes("USDT")
              ? "USDT"
              : tb.symbol;
            const coinData = priceData?.[base] || priceData?.[tb.symbol];
            const ch = coinData?.usd_24h_change;
            if (typeof ch === "number" && isFinite(ch)) {
              const pastUsd = tb.usdValue / (1 + ch / 100);
              const delta = tb.usdValue - pastUsd;
              deltaNowUSD += delta;
            }
          });
        }
        const pnl24hPct = totalValue > 0 ? (deltaNowUSD / totalValue) * 100 : 0;

        // 6. Build price change map
        const priceChange24hPctMap: Record<string, number> = {};
        tokenSymbols.forEach((symbol) => {
          const s = String(symbol || "").toUpperCase();
          const base = s.includes("BTC")
            ? "BTC"
            : s.includes("ETH")
            ? "ETH"
            : s.includes("USDC")
            ? "USDC"
            : s.includes("USDT")
            ? "USDT"
            : symbol;
          const coinData = priceData?.[base] || priceData?.[symbol];
          const ch = coinData?.usd_24h_change;
          if (typeof ch === "number" && isFinite(ch)) {
            priceChange24hPctMap[symbol] = ch;
            priceChange24hPctMap[base] = ch;
          }
        });

        setOverviewData({
          totalValue,
          tokenBalances,
          isLoading: false,
          error: undefined,
          priceMap: Object.fromEntries(priceMap.entries()),
          pnl24hPct,
          priceChange24hPctMap,
        });
      } catch (error) {
        console.error("Failed to fetch overview data:", error);
        setOverviewData({
          totalValue: 0,
          tokenBalances: [],
          isLoading: false,
          error: error instanceof Error ? error.message : "Unknown error",
          priceMap: {},
          pnl24hPct: 0,
          priceChange24hPctMap: {},
        });
      }
    };

    fetchOverviewData(userPositionsData || [], pricesData || {});
  }, [isConnected, accountAddress, refreshKey, userPositionsData, pricesData, networkMode]);

  return overviewData;
}

// Track optimistically removed position IDs
const optimisticallyRemovedIds = new Set<string>();

/**
 * Main overview hook combining data, positions, and APR
 * Adapted from Uniswap's usePortfolio pattern
 */
export function useOverview(
  networkMode: "mainnet" | "testnet",
  refreshKey: number = 0,
  userPositionsData?: any[],
  pricesData?: any,
  isLoadingHookPositions?: boolean
) {
  const { address: accountAddress, isConnected } = useAccount();

  // Get aggregated overview data
  const overviewData = useOverviewData(networkMode, refreshKey, userPositionsData, pricesData);

  // Position and APR states
  const [activePositions, setActivePositions] = useState<any[]>([]);
  const [aprByPoolId, setAprByPoolId] = useState<Record<string, string>>({});
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingPoolStates, setIsLoadingPoolStates] = useState<boolean>(true);

  // Process positions
  useEffect(() => {
    setIsLoadingPositions(!!isLoadingHookPositions);

    if (!isConnected || !accountAddress) {
      setActivePositions([]);
      if (!isLoadingHookPositions) setIsLoadingPositions(false);
      return;
    }

    const positionsRaw = userPositionsData || [];
    let positions = Array.isArray(positionsRaw) ? positionsRaw : [];

    // Filter to configured pools only
    try {
      const pools = getAllPools(networkMode);
      const allowedIds = new Set(
        (pools || []).map((p: any) => String(p?.subgraphId || "").toLowerCase())
      );
      positions = positions.filter((pos: any) => {
        const pid = String(pos?.poolId || "").toLowerCase();
        return pid && allowedIds.has(pid);
      });
    } catch {}

    // Filter out optimistically removed positions
    if (optimisticallyRemovedIds.size > 0) {
      const filteredPositions = positions.filter(
        (pos: any) => !optimisticallyRemovedIds.has(pos.positionId)
      );
      const stillInData = new Set(positions.map((p: any) => p.positionId));
      optimisticallyRemovedIds.forEach((id) => {
        if (!stillInData.has(id)) {
          optimisticallyRemovedIds.delete(id);
        }
      });
      setActivePositions(filteredPositions);
    } else {
      setActivePositions(positions);
    }
  }, [isConnected, accountAddress, userPositionsData, isLoadingHookPositions, networkMode]);

  // Fetch APR data
  useEffect(() => {
    const fetchApr = async () => {
      try {
        const response = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.success || !Array.isArray(data.pools)) return;
        const map: Record<string, string> = {};
        for (const p of data.pools as any[]) {
          const apr =
            typeof p.apr === "number" && isFinite(p.apr) && p.apr > 0
              ? `${p.apr.toFixed(2)}%`
              : "N/A";
          if (p.poolId) map[String(p.poolId).toLowerCase()] = apr;
        }
        setAprByPoolId(map);
      } catch {}
    };
    fetchApr();
  }, [networkMode]);

  useEffect(() => {
    setIsLoadingPoolStates(false);
  }, [activePositions, isLoadingPositions]);

  // Compute readiness state
  const readiness: Readiness = useMemo(() => {
    const isPositionsLoaded = !isLoadingPositions;
    const isEmpty = isPositionsLoaded && activePositions.length === 0;
    return {
      core: isPositionsLoaded && !isLoadingPoolStates,
      prices: isEmpty || Object.keys(overviewData.priceMap).length > 0,
      apr: isEmpty || Object.keys(aprByPoolId).length > 0,
    };
  }, [overviewData.priceMap, aprByPoolId, activePositions, isLoadingPositions, isLoadingPoolStates]);

  return {
    overviewData,
    activePositions,
    aprByPoolId,
    readiness,
    isLoadingPositions,
    isLoadingPoolStates,
    setActivePositions,
    setIsLoadingPositions,
    setAprByPoolId,
  };
}

/**
 * Mark a position as optimistically removed (for instant UI feedback)
 */
export function markPositionAsRemoved(positionId: string) {
  optimisticallyRemovedIds.add(positionId);
}

/**
 * Clear optimistic removal tracking
 */
export function clearOptimisticRemovals() {
  optimisticallyRemovedIds.clear();
}
