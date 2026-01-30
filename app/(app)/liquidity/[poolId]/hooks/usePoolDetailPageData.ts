"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { usePoolState } from "@/lib/apollo/hooks";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useWSPool } from "@/lib/websocket";
import { fetchPoolsMetrics } from "@/lib/backend-client";
import { getPoolById, getToken, getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { usePoolChartData, type ChartDataPoint } from "./usePoolChartData";
import { usePoolPositions } from "./usePoolPositions";
import type { V4ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";
import { isUnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";

/**
 * Position union type - combines V4 and Unified Yield positions
 * Each type is fetched through its own dedicated flow for clean separation
 */
type Position = V4ProcessedPosition | UnifiedYieldPosition;

/** Type guard for V4 positions */
function isV4Position(position: Position): position is V4ProcessedPosition {
  return position.type === 'v4';
}
import { TickMath, tickToPriceRelative, tickToPriceSimple } from "@/lib/liquidity/utils/tick-price";
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
  yieldSources?: Array<'aave' | 'spark'>;
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

  // Positions (discriminated union of V4 and Unified Yield)
  userPositions: Position[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  optimisticallyClearedFees: Set<string>;

  // Prices
  priceMap: Record<string, number>;
  isLoadingPrices: boolean;

  // Token definitions
  tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>;

  // Responsive
  windowWidth: number;

  // Tick/price utilities
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
  updatePositionOptimistically: (positionId: string, updates: Partial<V4ProcessedPosition>) => void;
  removePositionOptimistically: (positionId: string) => void;
  clearOptimisticFees: (positionId: string) => void;
  clearAllOptimisticStates: () => void;

  // USD calculations
  calculatePositionUsd: (position: Position) => number;
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
    yieldSources: poolConfig.yieldSources,
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
      // Use consolidated utility for relative price calculation
      const priceInToken1PerToken0 = tickToPriceRelative(tick, currentPoolTick, currentPriceNum);
      const priceAtTick = baseTokenForPriceDisplay === token0Symbol
        ? 1 / priceInToken1PerToken0
        : priceInToken1PerToken0;

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
    // Use consolidated utility for simple tick-to-price, then apply decimal adjustment
    const price01 = tickToPriceSimple(tick) * Math.pow(10, exp);
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

  // Pool state from real-time WebSocket (with Apollo as fallback)
  const { pool: wsPool, isConnected: wsConnected } = useWSPool(subgraphId || poolId);
  const { data: poolStateRaw } = usePoolState(subgraphId);

  // Pool state from Apollo (WebSocket only provides metrics, not tick/liquidity state)
  const poolState: PoolStateData = useMemo(() => {
    // Compute current price from WebSocket token prices if available
    const wsCurrentPrice = wsConnected && wsPool && wsPool.token0Price > 0
      ? String(wsPool.token1Price / wsPool.token0Price)
      : null;

    return {
      // Prefer WS-derived price, fall back to Apollo
      currentPrice: wsCurrentPrice ?? (poolStateRaw?.currentPrice ? String(poolStateRaw.currentPrice) : null),
      // Pool state data (tick, liquidity) comes from Apollo only
      currentPoolTick: typeof poolStateRaw?.currentPoolTick === 'number' ? poolStateRaw.currentPoolTick : null,
      sqrtPriceX96: poolStateRaw?.sqrtPriceX96 ? String(poolStateRaw.sqrtPriceX96) : null,
      liquidity: poolStateRaw?.liquidity ? String(poolStateRaw.liquidity) : null,
    };
  }, [wsConnected, wsPool, poolStateRaw]);

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

  // Prices hook — unified via useTokenPrices (replaces useAllPrices + hardcoded stablecoin lists)
  const poolTokenSymbols = useMemo(
    () => poolConfig?.tokens.map(t => t.symbol) || [],
    [poolConfig]
  );
  const { prices: priceMap, isLoading: isLoadingPrices } = useTokenPrices(poolTokenSymbols, { pollInterval: 60_000 });

  const calculatePositionUsd = useCallback((position: Position): number => {
    if (!position) return 0;

    // Handle V4 positions
    if (isV4Position(position)) {
      const amt0 = parseFloat(position.token0.amount || '0');
      const amt1 = parseFloat(position.token1.amount || '0');
      const p0 = priceMap[position.token0.symbol] ?? 0;
      const p1 = priceMap[position.token1.symbol] ?? 0;
      return (amt0 * p0) + (amt1 * p1);
    }

    // Handle Unified Yield positions
    if (isUnifiedYieldPosition(position)) {
      const amt0 = parseFloat(position.token0Amount || '0');
      const amt1 = parseFloat(position.token1Amount || '0');
      const p0 = priceMap[position.token0Symbol] ?? 0;
      const p1 = priceMap[position.token1Symbol] ?? 0;
      return (amt0 * p0) + (amt1 * p1);
    }

    return 0;
  }, [priceMap]);

  // Sort positions by USD value descending (same as Overview)
  const sortedPositions = useMemo(() => {
    return [...userPositions].sort((a, b) => calculatePositionUsd(b) - calculatePositionUsd(a));
  }, [userPositions, calculatePositionUsd]);

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

  // Update pool stats from WebSocket data when available
  useEffect(() => {
    if (wsConnected && wsPool) {
      const tvlUSD = wsPool.tvlUsd || 0;
      const volume24hUSD = wsPool.volume24hUsd || 0;
      const fees24hUSD = wsPool.fees24hUsd || 0;
      // apr24h is calculated in useWSPool from fees24hUsd/tvlUsd
      const aprRaw = wsPool.apr24h || 0;
      const dynamicFeeBps = wsPool.lpFee || null;

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

      updateTodayTvl(tvlUSD);
    }
  }, [wsConnected, wsPool, updateTodayTvl]);

  // Fetch pool stats from REST as fallback (initial load or when WS disconnected)
  useEffect(() => {
    if (!poolId || !subgraphId) return;
    // Skip REST fetch if WebSocket data is available
    if (wsConnected && wsPool) return;

    const fetchPoolStats = async () => {
      try {
        // Fetch all pools and filter for this one (backend only has /pools/metrics, not /pools/{id}/metrics)
        const response = await fetchPoolsMetrics(networkMode);

        if (!response.success || !response.pools) {
          console.warn('[usePoolDetailPageData] Failed to fetch pool metrics:', response.error);
          return;
        }

        // Find this pool in the response
        const pool = response.pools.find(p => p.poolId.toLowerCase() === subgraphId.toLowerCase());
        if (!pool) {
          console.warn('[usePoolDetailPageData] Pool not found in metrics:', subgraphId);
          return;
        }

        const tvlUSD = pool.tvlUsd || 0;
        const volume24hUSD = pool.volume24hUsd || 0;
        const fees24hUSD = pool.fees24hUsd || 0;
        // Calculate APR same as WebSocket: (fees24h / tvl) * 365 * 100
        const aprRaw = tvlUSD > 0 ? (fees24hUSD / tvlUSD) * 365 * 100 : 0;
        const dynamicFeeBps = pool.lpFee || null;

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

        updateTodayTvl(tvlUSD);
      } catch (error) {
        console.error('[usePoolDetailPageData] Failed to fetch pool stats:', error);
      }
    };

    fetchPoolStats();
  }, [poolId, subgraphId, networkMode, updateTodayTvl, wsConnected, wsPool]);

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
    userPositions: sortedPositions,
    isLoadingPositions,
    isDerivingNewPosition,
    optimisticallyClearedFees,
    priceMap,
    isLoadingPrices,
    tokenDefinitions,
    windowWidth,
    convertTickToPrice,
    refreshPositions,
    refreshAfterLiquidityAdded,
    refreshAfterMutation,
    updatePositionOptimistically,
    removePositionOptimistically,
    clearOptimisticFees,
    clearAllOptimisticStates,
    calculatePositionUsd,
  };
}
