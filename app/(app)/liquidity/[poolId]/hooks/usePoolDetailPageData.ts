"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { usePoolState, useAllPrices } from "@/lib/apollo/hooks";
import { getPoolById, getToken, getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { SafeStorage } from "@/lib/safe-storage";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { usePoolChartData, type ChartDataPoint } from "./usePoolChartData";
import { usePoolPositions } from "./usePoolPositions";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { TickMath } from "@uniswap/v3-sdk";
import { formatUSD as formatUSDShared } from "@/lib/format";

// Re-export ChartDataPoint for convenience
export type { ChartDataPoint };

const DEFAULT_TICK_SPACING = 60;

// Format USD value (centralized)
const formatUSD = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 1_000_000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatUSDShared(value);
};

export interface PoolConfig {
  id: string;
  subgraphId?: string;
  tokens: Array<{
    symbol: string;
    icon: string;
    address: string;
  }>;
  pair: string;
  tickSpacing: number;
  type?: string;
  hooks?: string;
}

export interface PoolStats {
  tvlUSD: number;
  volume24hUSD: number;
  fees24hUSD: number;
  apr: string;
  aprRaw: number;
  dynamicFeeBps: number | null;
  // Formatted strings for display
  tvlFormatted: string;
  volume24hFormatted: string;
  fees24hFormatted: string;
}

export interface PoolStateData {
  currentPrice: string | null;
  currentPoolTick: number | null;
  sqrtPriceX96: string | null;
  liquidity: string | null;
}

export interface UsePoolDetailPageDataReturn {
  // Pool configuration
  poolConfig: PoolConfig | null;
  poolStats: PoolStats;
  poolState: PoolStateData;

  // Chart data
  chartData: ChartDataPoint[];
  isLoadingChartData: boolean;

  // Positions
  userPositions: ProcessedPosition[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;

  // Prices
  priceMap: Record<string, number>;
  isLoadingPrices: boolean;

  // Denomination
  effectiveDenominationBase: string;
  denominationBaseOverride: string | null;
  handleDenominationToggle: (newBase: string) => void;

  // Token definitions
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>;

  // Tick/price utilities
  sdkMinTick: number;
  sdkMaxTick: number;
  convertTickToPrice: (
    tick: number,
    currentPoolTick: number | null,
    currentPrice: string | null,
    baseTokenForPriceDisplay: string,
    token0Symbol: string,
    token1Symbol: string
  ) => string;

  // Callbacks for mutations
  refreshPositions: () => Promise<void>;
  refreshAfterLiquidityAdded: (options?: {
    token0Symbol?: string;
    token1Symbol?: string;
    txInfo?: { txHash?: `0x${string}`; blockNumber?: bigint; tvlDelta?: number; volumeDelta?: number };
  }) => Promise<void>;
  refreshAfterMutation: (info?: { txHash?: `0x${string}`; tvlDelta?: number }) => Promise<void>;
  updatePositionOptimistically: (positionId: string, updates: Partial<ProcessedPosition>) => void;
  removePositionOptimistically: (positionId: string) => void;
  clearOptimisticFees: (positionId: string) => void;
  clearAllOptimisticStates: () => void;

  // USD calculations
  getUsdPriceForSymbol: (symbol?: string) => number;
  calculatePositionUsd: (position: ProcessedPosition) => number;
}

/**
 * Get pool configuration from pools.json
 */
function getPoolConfiguration(poolId: string): PoolConfig | null {
  const poolConfig = getPoolById(poolId);
  if (!poolConfig) return null;

  const token0 = getToken(poolConfig.currency0.symbol);
  const token1 = getToken(poolConfig.currency1.symbol);

  if (!token0 || !token1) return null;

  return {
    id: poolConfig.id,
    subgraphId: poolConfig.subgraphId,
    tokens: [
      { symbol: token0.symbol, icon: token0.icon, address: token0.address },
      { symbol: token1.symbol, icon: token1.icon, address: token1.address },
    ],
    pair: `${token0.symbol} / ${token1.symbol}`,
    tickSpacing: poolConfig.tickSpacing || DEFAULT_TICK_SPACING,
    type: poolConfig.type,
    hooks: poolConfig.hooks,
  };
}

/**
 * Convert tick to price using current pool state
 */
function convertTickToPriceImpl(
  tick: number,
  currentPoolTick: number | null,
  currentPrice: string | null,
  baseTokenForPriceDisplay: string,
  token0Symbol: string,
  token1Symbol: string,
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>
): string {
  // Preferred: relative to live current price when available
  if (currentPoolTick !== null && currentPrice) {
    const currentPriceNum = parseFloat(currentPrice);
    if (Number.isFinite(currentPriceNum) && currentPriceNum > 0) {
      const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
      const priceAtTick = baseTokenForPriceDisplay === token0Symbol
        ? 1 / (currentPriceNum * priceDelta)
        : currentPriceNum * priceDelta;

      if (Number.isFinite(priceAtTick)) {
        if (priceAtTick < 1e-11 && priceAtTick > 0) return "0";
        if (priceAtTick > 1e30) return "∞";
        return priceAtTick.toFixed(6);
      }
    }
  }

  // Fallback: derive absolute price from tick + decimals
  try {
    const cfg0 = tokenDefinitions[token0Symbol as TokenSymbol];
    const cfg1 = tokenDefinitions[token1Symbol as TokenSymbol];
    const addr0 = (cfg0?.address || `0x${token0Symbol}`).toLowerCase();
    const addr1 = (cfg1?.address || `0x${token1Symbol}`).toLowerCase();
    const dec0 = cfg0?.decimals ?? 18;
    const dec1 = cfg1?.decimals ?? 18;
    const sorted0IsToken0 = addr0 < addr1;
    const sorted0Decimals = sorted0IsToken0 ? dec0 : dec1;
    const sorted1Decimals = sorted0IsToken0 ? dec1 : dec0;
    const exp = sorted0Decimals - sorted1Decimals;
    const price01 = Math.pow(1.0001, tick) * Math.pow(10, exp);
    const baseIsToken0 = baseTokenForPriceDisplay === token0Symbol;
    const baseMatchesSorted0 = baseIsToken0 === sorted0IsToken0;
    const displayVal = baseMatchesSorted0 ? (price01 === 0 ? Infinity : 1 / price01) : price01;

    if (!Number.isFinite(displayVal) || isNaN(displayVal)) return 'N/A';
    if (displayVal < 1e-11 && displayVal > 0) return '0';
    if (displayVal > 1e30) return '∞';
    return displayVal.toFixed(6);
  } catch {
    return 'N/A';
  }
}

export function usePoolDetailPageData(poolId: string): UsePoolDetailPageDataReturn {
  const { networkMode } = useNetwork();
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Window width for responsive chart
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== 'undefined') {
      setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Get pool configuration (synchronous)
  const poolConfig = useMemo(() => getPoolConfiguration(poolId), [poolId]);
  const subgraphId = poolConfig?.subgraphId || '';

  // Pool state from real-time hook
  const { data: poolStateRaw } = usePoolState(subgraphId);
  const poolState: PoolStateData = useMemo(() => ({
    currentPrice: poolStateRaw?.currentPrice ? String(poolStateRaw.currentPrice) : null,
    currentPoolTick: typeof poolStateRaw?.currentPoolTick === 'number' ? poolStateRaw.currentPoolTick : null,
    sqrtPriceX96: poolStateRaw?.sqrtPriceX96 ? String(poolStateRaw.sqrtPriceX96) : null,
    liquidity: poolStateRaw?.liquidity ? String(poolStateRaw.liquidity) : null,
  }), [poolStateRaw]);

  // Pool stats state
  const [poolStats, setPoolStats] = useState<PoolStats>({
    tvlUSD: 0,
    volume24hUSD: 0,
    fees24hUSD: 0,
    apr: 'Loading...',
    aprRaw: 0,
    dynamicFeeBps: null,
    tvlFormatted: 'Loading...',
    volume24hFormatted: 'Loading...',
    fees24hFormatted: 'Loading...',
  });

  // Chart data hook
  const {
    chartData,
    isLoadingChartData,
    fetchChartData,
    updateTodayTvl,
  } = usePoolChartData({
    poolId,
    subgraphId,
    networkMode,
    windowWidth,
  });

  // Positions hook
  const {
    userPositions,
    isLoadingPositions,
    isDerivingNewPosition,
    optimisticallyClearedFees,
    refreshPositions,
    refreshAfterLiquidityAdded,
    refreshAfterMutation,
    updatePositionOptimistically,
    removePositionOptimistically,
    clearOptimisticFees,
    clearAllOptimisticStates,
  } = usePoolPositions({
    poolId,
    subgraphId,
  });

  // Prices hook
  const { data: allPrices } = useAllPrices();
  const isLoadingPrices = !allPrices;

  // Extract USD price from various formats
  const extractUsd = useCallback((value: unknown, fallback: number): number => {
    if (typeof value === 'number') return value;
    if (value && typeof (value as Record<string, unknown>).usd === 'number') {
      return (value as Record<string, number>).usd;
    }
    return fallback;
  }, []);

  const getUsdPriceForSymbol = useCallback((symbolRaw?: string): number => {
    const symbol = (symbolRaw || '').toUpperCase();
    if (!symbol) return 0;
    if (['USDC', 'AUSDC', 'USDT', 'AUSDT', 'MUSDT', 'YUSD', 'DAI', 'ADAI'].includes(symbol)) {
      return extractUsd(allPrices?.USDC, 1);
    }
    if (['ETH', 'AETH'].includes(symbol)) {
      return extractUsd(allPrices?.ETH, 0);
    }
    if (['BTC', 'ABTC'].includes(symbol)) {
      return extractUsd(allPrices?.BTC, 0);
    }
    return 0;
  }, [allPrices, extractUsd]);

  const calculatePositionUsd = useCallback((position: ProcessedPosition): number => {
    if (!position) return 0;
    const amt0 = parseFloat(position.token0.amount || '0');
    const amt1 = parseFloat(position.token1.amount || '0');
    const p0 = getUsdPriceForSymbol(position.token0.symbol);
    const p1 = getUsdPriceForSymbol(position.token1.symbol);
    return (amt0 * p0) + (amt1 * p1);
  }, [getUsdPriceForSymbol]);

  // Price map for components
  const priceMap = useMemo(() => ({
    USDC: extractUsd(allPrices?.USDC, 1),
    ETH: extractUsd(allPrices?.ETH, 0),
    BTC: extractUsd(allPrices?.BTC, 0),
  }), [allPrices, extractUsd]);

  // Denomination toggle
  const [denominationBaseOverride, setDenominationBaseOverride] = useState<string | null>(null);
  const token0Symbol = poolConfig?.tokens?.[0]?.symbol || '';
  const token1Symbol = poolConfig?.tokens?.[1]?.symbol || '';

  const effectiveDenominationBase = useMemo(() => {
    if (
      denominationBaseOverride &&
      (denominationBaseOverride === token0Symbol || denominationBaseOverride === token1Symbol)
    ) {
      return denominationBaseOverride;
    }
    const priceNum = poolState.currentPrice ? parseFloat(poolState.currentPrice) : undefined;
    return getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
  }, [denominationBaseOverride, token0Symbol, token1Symbol, poolState.currentPrice]);

  // Load saved denomination preference
  useEffect(() => {
    const storageKey = `denomination-base-${poolId}`;
    const saved = SafeStorage.get(storageKey);
    if (saved && (saved === token0Symbol || saved === token1Symbol)) {
      setDenominationBaseOverride(saved);
    }
  }, [poolId, token0Symbol, token1Symbol]);

  const handleDenominationToggle = useCallback((newBase: string) => {
    setDenominationBaseOverride(newBase);
    SafeStorage.set(`denomination-base-${poolId}`, newBase);
  }, [poolId]);

  // Convert tick to price (bound to tokenDefinitions)
  const convertTickToPrice = useCallback(
    (
      tick: number,
      currentPoolTick: number | null,
      currentPrice: string | null,
      baseTokenForPriceDisplay: string,
      t0Symbol: string,
      t1Symbol: string
    ) => convertTickToPriceImpl(tick, currentPoolTick, currentPrice, baseTokenForPriceDisplay, t0Symbol, t1Symbol, tokenDefinitions),
    [tokenDefinitions]
  );

  // Fetch pool stats
  useEffect(() => {
    if (!poolId || !subgraphId) return;

    const fetchPoolStats = async () => {
      try {
        const resp = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);
        if (!resp.ok) return;

        const data = await resp.json();
        const poolIdLc = subgraphId.toLowerCase();
        const pools = Array.isArray(data?.pools) ? data.pools : [];
        const match = pools.find((p: { poolId?: string }) => String(p.poolId || '').toLowerCase() === poolIdLc);

        if (match) {
          const tvlUSD = Number(match.tvlUSD) || 0;
          const volume24hUSD = Number(match.volume24hUSD) || 0;
          const fees24hUSD = Number(match.fees24hUSD) || 0;
          const aprRaw = Number(match.apr) || 0;
          const dynamicFeeBps = typeof match.dynamicFeeBps === 'number' ? match.dynamicFeeBps : null;

          const aprFormatted = Number.isFinite(aprRaw) && aprRaw > 0
            ? (aprRaw < 1000 ? `${aprRaw.toFixed(2)}%` : `${(aprRaw / 1000).toFixed(2)}K%`)
            : '0.00%';

          setPoolStats({
            tvlUSD,
            volume24hUSD,
            fees24hUSD,
            apr: aprFormatted,
            aprRaw,
            dynamicFeeBps,
            tvlFormatted: formatUSD(tvlUSD),
            volume24hFormatted: formatUSD(volume24hUSD),
            fees24hFormatted: formatUSD(fees24hUSD),
          });

          // Update today's TVL in chart
          updateTodayTvl(tvlUSD);
        }
      } catch (error) {
        console.error('[usePoolDetailPageData] Failed to fetch pool stats:', error);
      }
    };

    fetchPoolStats();
  }, [poolId, subgraphId, networkMode, updateTodayTvl]);

  // Fetch chart data on mount
  useEffect(() => {
    if (poolId && chartData.length === 0) {
      fetchChartData();
    }
  }, [poolId, chartData.length, fetchChartData]);

  return {
    poolConfig,
    poolStats,
    poolState,
    chartData,
    isLoadingChartData,
    userPositions,
    isLoadingPositions,
    isDerivingNewPosition,
    optimisticallyClearedFees,
    priceMap,
    isLoadingPrices,
    effectiveDenominationBase,
    denominationBaseOverride,
    handleDenominationToggle,
    tokenDefinitions,
    sdkMinTick: TickMath.MIN_TICK,
    sdkMaxTick: TickMath.MAX_TICK,
    convertTickToPrice,
    refreshPositions,
    refreshAfterLiquidityAdded,
    refreshAfterMutation,
    updatePositionOptimistically,
    removePositionOptimistically,
    clearOptimisticFees,
    clearAllOptimisticStates,
    getUsdPriceForSymbol,
    calculatePositionUsd,
  };
}
