"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { getAllPools } from "@/lib/pools-config";
import { fetchPoolsMetrics } from "@/lib/backend-client";
import { useTokenPrices } from "@/hooks/useTokenPrices";

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
 *
 * Prices are fetched via useTokenPrices (React Query polling + V4 Quoter + CoinGecko fallback).
 */
export function useOverviewData(
  networkMode: "mainnet" | "testnet",
  refreshKey: number = 0,
  userPositionsData?: any[],
  pricesData?: any
): OverviewData {
  const { address: accountAddress, isConnected } = useAccount();

  // 1. Filter positions to configured pools only
  const filteredPositions = useMemo(() => {
    if (!isConnected || !accountAddress) return [];
    const positionsRaw = userPositionsData || [];
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
    return positions;
  }, [isConnected, accountAddress, userPositionsData, networkMode]);

  // 2. Extract unique token symbols for price fetching
  const tokenSymbols = useMemo(() => {
    const symbols = new Set<string>();
    filteredPositions.forEach((pos: any) => {
      const t0 = pos.token0?.symbol;
      const t1 = pos.token1?.symbol;
      if (t0) symbols.add(t0);
      if (t1) symbols.add(t1);
    });
    return Array.from(symbols);
  }, [filteredPositions]);

  // 3. Fetch prices via unified hook (replaces direct batchQuotePrices call)
  // Uses React Query with polling, retries, and deduplication
  const { prices: priceMap, isLoading: isPricesLoading } = useTokenPrices(tokenSymbols, { pollInterval: 60_000 });

  // 4. Aggregate overview data from positions + prices (reactive — recomputes when prices update)
  const overviewData = useMemo((): OverviewData => {
    if (!isConnected || !accountAddress) {
      return {
        totalValue: 0,
        tokenBalances: [],
        isLoading: false,
        error: undefined,
        priceMap: {},
        pnl24hPct: 0,
        priceChange24hPctMap: {},
      };
    }

    // Aggregate token balances from positions
    const tokenBalanceMap = new Map<string, number>();
    filteredPositions.forEach((position: any) => {
      const t0 = position.token0?.symbol;
      const a0 = parseFloat(position.token0?.amount || "0");
      if (t0 && a0 > 0) tokenBalanceMap.set(t0, (tokenBalanceMap.get(t0) || 0) + a0);

      const t1 = position.token1?.symbol;
      const a1 = parseFloat(position.token1?.amount || "0");
      if (t1 && a1 > 0) tokenBalanceMap.set(t1, (tokenBalanceMap.get(t1) || 0) + a1);
    });

    // Create token balances with USD values and colors
    const tokenBalances: TokenBalance[] = Array.from(tokenBalanceMap.entries())
      .map(([symbol, balance]) => ({
        symbol,
        balance,
        usdValue: balance * (priceMap[symbol] || 0),
        color: "",
      }))
      .filter((token) => token.usdValue > 0.01)
      .sort((a, b) => b.usdValue - a.usdValue);

    // Assign colors after sorting
    tokenBalances.forEach((token, index) => {
      token.color = TOKEN_COLORS[index % TOKEN_COLORS.length];
    });

    const totalValue = tokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

    // Compute portfolio 24h PnL %
    let deltaNowUSD = 0;
    if (totalValue > 0 && pricesData) {
      tokenBalances.forEach((tb) => {
        const s = String(tb.symbol || "").toUpperCase();
        const base = s.includes("BTC")
          ? "BTC"
          : s.includes("ETH")
          ? "ETH"
          : s.includes("USDC")
          ? "USDC"
          : tb.symbol;
        const coinData = pricesData?.[base] || pricesData?.[tb.symbol];
        const ch = coinData?.usd_24h_change;
        if (typeof ch === "number" && isFinite(ch)) {
          const pastUsd = tb.usdValue / (1 + ch / 100);
          const delta = tb.usdValue - pastUsd;
          deltaNowUSD += delta;
        }
      });
    }
    const pnl24hPct = totalValue > 0 ? (deltaNowUSD / totalValue) * 100 : 0;

    // Build price change map
    const priceChange24hPctMap: Record<string, number> = {};
    if (pricesData) {
      tokenSymbols.forEach((symbol) => {
        const s = String(symbol || "").toUpperCase();
        const base = s.includes("BTC")
          ? "BTC"
          : s.includes("ETH")
          ? "ETH"
          : s.includes("USDC")
          ? "USDC"
          : symbol;
        const coinData = pricesData?.[base] || pricesData?.[symbol];
        const ch = coinData?.usd_24h_change;
        if (typeof ch === "number" && isFinite(ch)) {
          priceChange24hPctMap[symbol] = ch;
          priceChange24hPctMap[base] = ch;
        }
      });
    }

    return {
      totalValue,
      tokenBalances,
      isLoading: isPricesLoading && tokenSymbols.length > 0,
      error: undefined,
      priceMap,
      pnl24hPct,
      priceChange24hPctMap,
    };
  }, [isConnected, accountAddress, filteredPositions, priceMap, isPricesLoading, tokenSymbols, pricesData]);

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

  // Fetch APR data from backend
  useEffect(() => {
    const fetchApr = async () => {
      try {
        const response = await fetchPoolsMetrics(networkMode);
        if (!response.success || !Array.isArray(response.pools)) return;
        const map: Record<string, string> = {};
        for (const pool of response.pools) {
          // Calculate APR same as WebSocket: (fees24h / tvl) * 365 * 100
          const aprValue = pool.tvlUsd > 0 ? (pool.fees24hUsd / pool.tvlUsd) * 365 * 100 : 0;
          const apr = isFinite(aprValue) && aprValue > 0
            ? `${aprValue.toFixed(2)}%`
            : "N/A";
          if (pool.poolId) map[String(pool.poolId).toLowerCase()] = apr;
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
