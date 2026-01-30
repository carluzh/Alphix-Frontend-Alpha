"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { CurrencyAmount, Token, Price, Currency } from "@uniswap/sdk-core";
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import { getAddress, type Address } from "viem";
import { getAllPools, getToken, type PoolConfig, type TokenConfig } from "@/lib/pools-config";
import { useUSDCPriceRaw } from "@/lib/uniswap/hooks/useUSDCPrice";
import { usePoolPriceChartData } from "@/lib/chart/hooks/usePoolPriceChartData";
import { HistoryDuration } from "@/lib/chart/types";
import { useNetwork } from "@/lib/network-context";
import { fetchAaveRates, getAaveKey } from "@/lib/aave-rates";
import { fetchPositionApr, fetchPoolsMetrics } from "@/lib/backend-client";
import {
  fetchSingleUnifiedYieldPosition,
  parseUnifiedYieldPositionId,
  type UnifiedYieldPosition,
} from "@/lib/liquidity/unified-yield";
import { usePriceOrdering, useGetRangeDisplay } from "@/lib/uniswap/liquidity/hooks";

// ============================================================================
// Types
// ============================================================================

export type LPType = "rehypo" | "concentrated";

export type ChartDuration = "1D" | "1W" | "1M" | "1Y" | "ALL";

// Map UI duration to HistoryDuration enum
const DURATION_MAP: Record<ChartDuration, HistoryDuration> = {
  "1D": HistoryDuration.DAY,
  "1W": HistoryDuration.WEEK,
  "1M": HistoryDuration.MONTH,
  "1Y": HistoryDuration.YEAR,
  "ALL": HistoryDuration.YEAR, // Use YEAR as fallback for ALL
};

export interface PositionInfo {
  tokenId: string;
  owner: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

export interface PoolStateData {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export interface PositionPageData {
  // Position data
  position: V4Position | null;
  positionInfo: PositionInfo | null;
  unifiedYieldPosition: UnifiedYieldPosition | null;
  isLoading: boolean;
  error: Error | null;
  // Pool data
  poolConfig: PoolConfig | null;
  poolState: PoolStateData | null;
  // Token amounts
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  // USD values
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  // Fees
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  // Price info
  currentPrice: Price<Currency, Currency> | null;
  currentPriceNumeric: number | null;
  priceInverted: boolean;
  setPriceInverted: (inverted: boolean) => void;
  // Range display
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string | undefined;
  tokenBSymbol: string | undefined;
  isFullRange: boolean | undefined;
  isInRange: boolean;
  // APR data
  poolApr: number | null;
  aaveApr: number | null;
  totalApr: number | null;
  // LP Type
  lpType: LPType;
  // Chart
  chartDuration: ChartDuration;
  setChartDuration: (duration: ChartDuration) => void;
  chartData: { time: number; value: number }[];
  isLoadingChart: boolean;
  // Denomination
  effectiveDenominationBase: boolean;
  handleDenominationToggle: () => void;
  // Ownership
  isOwner: boolean;
  // Actions
  refetch: () => void;
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchPosition(tokenId: string): Promise<PositionInfo | null> {
  // Don't fetch V4 position for Unified Yield position IDs
  if (!tokenId || tokenId.startsWith('uy-')) return null;

  const response = await fetch(`/api/liquidity/get-position?tokenId=${tokenId}`);
  if (!response.ok) {
    throw new Error("Failed to fetch position");
  }

  const data = await response.json();
  if (!data.position) return null;

  // Convert string values to bigint for SDK compatibility
  return {
    ...data.position,
    liquidity: BigInt(data.position.liquidity),
    feeGrowthInside0LastX128: BigInt(data.position.feeGrowthInside0LastX128),
    feeGrowthInside1LastX128: BigInt(data.position.feeGrowthInside1LastX128),
    tokensOwed0: BigInt(data.position.tokensOwed0),
    tokensOwed1: BigInt(data.position.tokensOwed1),
  };
}

async function fetchPoolState(poolId: string): Promise<PoolStateData | null> {
  if (!poolId) return null;

  const response = await fetch(`/api/liquidity/get-pool-state?poolId=${poolId}`);
  if (!response.ok) {
    throw new Error("Failed to fetch pool state");
  }

  const data = await response.json();
  // Convert string values to bigint
  return {
    sqrtPriceX96: BigInt(data.sqrtPriceX96 || "0"),
    tick: data.tick || 0,
    liquidity: BigInt(data.liquidity || "0"),
  };
}

// ============================================================================
// Main Hook
// ============================================================================

export function usePositionPageData(tokenId: string): PositionPageData {
  const { address, chainId = 8453 } = useAccount();
  const { networkMode } = useNetwork();
  const publicClient = usePublicClient();
  const [priceInverted, setPriceInverted] = useState(false);
  const [chartDuration, setChartDuration] = useState<ChartDuration>("1W");
  const [denominationBase, setDenominationBase] = useState(true);

  // Check if this is a Unified Yield position (uy-{hookAddress}-{userAddress})
  const unifiedYieldParsed = useMemo(() => parseUnifiedYieldPositionId(tokenId), [tokenId]);
  const isUnifiedYieldPosition = !!unifiedYieldParsed;

  // Fetch Unified Yield position (if applicable)
  const {
    data: unifiedYieldPosition,
    isLoading: isLoadingUnifiedYield,
    error: unifiedYieldError,
    refetch: refetchUnifiedYield,
  } = useQuery({
    queryKey: ["unified-yield-position-detail", unifiedYieldParsed?.hookAddress, unifiedYieldParsed?.userAddress, networkMode],
    queryFn: async () => {
      if (!unifiedYieldParsed || !publicClient) return null;
      return fetchSingleUnifiedYieldPosition(
        unifiedYieldParsed.hookAddress,
        unifiedYieldParsed.userAddress,
        publicClient,
        networkMode
      );
    },
    enabled: isUnifiedYieldPosition && !!publicClient,
    staleTime: 30_000,
  });

  // Fetch V4 position info (if not Unified Yield)
  // Note: Only runs for V4 positions (non-uy- prefix)
  const {
    data: positionInfo,
    isLoading: isLoadingPosition,
    error: positionError,
    refetch: refetchV4,
  } = useQuery({
    queryKey: ["position", "v4", tokenId],
    queryFn: () => fetchPosition(tokenId),
    enabled: !!tokenId && !isUnifiedYieldPosition,
    staleTime: 30_000,
    retry: false, // Don't retry on 400 errors
  });

  // Combined refetch
  const refetch = useCallback(() => {
    if (isUnifiedYieldPosition) {
      return refetchUnifiedYield();
    }
    return refetchV4();
  }, [isUnifiedYieldPosition, refetchUnifiedYield, refetchV4]);

  // Get pool config from position info (handles both V4 and Unified Yield)
  const poolConfig = useMemo((): PoolConfig | null => {
    const allPools = getAllPools(networkMode);

    // For Unified Yield positions, find pool by hook address
    if (isUnifiedYieldPosition && unifiedYieldParsed) {
      const config = allPools.find(
        (pool) => pool.hooks?.toLowerCase() === unifiedYieldParsed.hookAddress.toLowerCase()
      );
      return config || null;
    }

    // For V4 positions, find pool by token addresses
    if (!positionInfo) return null;

    const config = allPools.find(
      (pool) =>
        (pool.currency0.address.toLowerCase() === positionInfo.token0.toLowerCase() &&
          pool.currency1.address.toLowerCase() === positionInfo.token1.toLowerCase()) ||
        (pool.currency0.address.toLowerCase() === positionInfo.token1.toLowerCase() &&
          pool.currency1.address.toLowerCase() === positionInfo.token0.toLowerCase())
    );
    return config || null;
  }, [positionInfo, isUnifiedYieldPosition, unifiedYieldParsed, networkMode]);

  // Get token configs
  const token0Config = useMemo((): TokenConfig | null => {
    if (!poolConfig) return null;
    return getToken(poolConfig.currency0.symbol);
  }, [poolConfig]);

  const token1Config = useMemo((): TokenConfig | null => {
    if (!poolConfig) return null;
    return getToken(poolConfig.currency1.symbol);
  }, [poolConfig]);

  // Determine LP type
  // V4 positions (via Position Manager) are always "concentrated" - they don't participate in rehypothecation
  // Only Unified Yield positions (uy- prefix) are "rehypo" - they earn yield from lending protocols
  const lpType: LPType = isUnifiedYieldPosition ? "rehypo" : "concentrated";

  // Fetch pool state
  const { data: poolState, isLoading: isLoadingPool } = useQuery({
    queryKey: ["poolState", poolConfig?.id],
    queryFn: () => fetchPoolState(poolConfig?.id || ""),
    enabled: !!poolConfig?.id,
    staleTime: 30_000,
  });

  // Build Position SDK object using V4 SDK
  const { position, pool } = useMemo((): { position: V4Position | null; pool: V4Pool | null } => {
    if (!positionInfo || !poolConfig || !poolState || !token0Config || !token1Config) {
      return { position: null, pool: null };
    }

    try {
      // Create Token instances
      const tokenA = new Token(
        chainId,
        getAddress(token0Config.address),
        token0Config.decimals,
        token0Config.symbol,
        token0Config.name
      );
      const tokenB = new Token(
        chainId,
        getAddress(token1Config.address),
        token1Config.decimals,
        token1Config.symbol,
        token1Config.name
      );

      // Sort tokens by address (Uniswap SDK requirement)
      const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];

      // V4Pool requires: token0, token1, fee, tickSpacing, hooks, sqrtPriceX96, liquidity, tick
      const v4Pool = new V4Pool(
        token0,
        token1,
        poolConfig.fee,
        poolConfig.tickSpacing,
        getAddress(poolConfig.hooks) as `0x${string}`,
        JSBI.BigInt(poolState.sqrtPriceX96.toString()),
        JSBI.BigInt(poolState.liquidity.toString()),
        poolState.tick
      );

      // V4Position requires: pool, tickLower, tickUpper, liquidity
      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower: positionInfo.tickLower,
        tickUpper: positionInfo.tickUpper,
        liquidity: JSBI.BigInt(positionInfo.liquidity.toString()),
      });

      return { position: v4Position, pool: v4Pool };
    } catch (e) {
      console.error("[usePositionPageData] Error building position:", e);
      return { position: null, pool: null };
    }
  }, [positionInfo, poolConfig, poolState, token0Config, token1Config, chainId]);

  // Token amounts from position (handles both V4 and Unified Yield)
  const currency0Amount = useMemo(() => {
    // For Unified Yield positions, use the fetched token amounts
    if (isUnifiedYieldPosition && unifiedYieldPosition && token0Config) {
      const token0 = new Token(
        chainId,
        getAddress(token0Config.address),
        token0Config.decimals,
        token0Config.symbol,
        token0Config.name
      );
      // unifiedYieldPosition.token0AmountRaw is bigint
      return CurrencyAmount.fromRawAmount(token0, unifiedYieldPosition.token0AmountRaw.toString());
    }
    // For V4 positions, use SDK position amounts
    return position?.amount0 || null;
  }, [isUnifiedYieldPosition, unifiedYieldPosition, position, token0Config, chainId]);

  const currency1Amount = useMemo(() => {
    // For Unified Yield positions, use the fetched token amounts
    if (isUnifiedYieldPosition && unifiedYieldPosition && token1Config) {
      const token1 = new Token(
        chainId,
        getAddress(token1Config.address),
        token1Config.decimals,
        token1Config.symbol,
        token1Config.name
      );
      return CurrencyAmount.fromRawAmount(token1, unifiedYieldPosition.token1AmountRaw.toString());
    }
    // For V4 positions, use SDK position amounts
    return position?.amount1 || null;
  }, [isUnifiedYieldPosition, unifiedYieldPosition, position, token1Config, chainId]);

  // USD prices - pass Token objects to the hook
  const { price: price0 } = useUSDCPriceRaw(currency0Amount?.currency);
  const { price: price1 } = useUSDCPriceRaw(currency1Amount?.currency);

  // USD values
  const fiatValue0 = useMemo(() => {
    if (!currency0Amount || !price0) return null;
    return parseFloat(currency0Amount.toExact()) * price0;
  }, [currency0Amount, price0]);

  const fiatValue1 = useMemo(() => {
    if (!currency1Amount || !price1) return null;
    return parseFloat(currency1Amount.toExact()) * price1;
  }, [currency1Amount, price1]);

  const totalPositionValue = useMemo(() => {
    if (fiatValue0 === null && fiatValue1 === null) return null;
    return (fiatValue0 || 0) + (fiatValue1 || 0);
  }, [fiatValue0, fiatValue1]);

  // Fee amounts (Unified Yield doesn't have separate fee tracking - fees are compounded)
  const fee0Amount = useMemo(() => {
    // Unified Yield positions don't track fees separately
    if (isUnifiedYieldPosition) return null;
    if (!positionInfo || !token0Config) return null;
    const token0 = new Token(
      chainId,
      token0Config.address,
      token0Config.decimals,
      token0Config.symbol
    );
    return CurrencyAmount.fromRawAmount(token0, positionInfo.tokensOwed0.toString());
  }, [isUnifiedYieldPosition, positionInfo, token0Config, chainId]);

  const fee1Amount = useMemo(() => {
    // Unified Yield positions don't track fees separately
    if (isUnifiedYieldPosition) return null;
    if (!positionInfo || !token1Config) return null;
    const token1 = new Token(
      chainId,
      token1Config.address,
      token1Config.decimals,
      token1Config.symbol
    );
    return CurrencyAmount.fromRawAmount(token1, positionInfo.tokensOwed1.toString());
  }, [isUnifiedYieldPosition, positionInfo, token1Config, chainId]);

  const fiatFeeValue0 = useMemo(() => {
    if (!fee0Amount || !price0) return null;
    return parseFloat(fee0Amount.toExact()) * price0;
  }, [fee0Amount, price0]);

  const fiatFeeValue1 = useMemo(() => {
    if (!fee1Amount || !price1) return null;
    return parseFloat(fee1Amount.toExact()) * price1;
  }, [fee1Amount, price1]);

  const totalFeesValue = useMemo(() => {
    if (fiatFeeValue0 === null && fiatFeeValue1 === null) return null;
    return (fiatFeeValue0 || 0) + (fiatFeeValue1 || 0);
  }, [fiatFeeValue0, fiatFeeValue1]);

  // Current price (SDK object — null for Unified Yield positions)
  const currentPrice = pool?.token0Price || null;

  // Numeric current price in token1/token0 format (works for both V4 and Unified Yield)
  // Computed from poolState.sqrtPriceX96 so it's available even when the SDK pool isn't built
  const currentPriceNumeric = useMemo((): number | null => {
    // For V4 positions with SDK pool, use SDK's computed price
    if (pool) {
      try {
        return parseFloat(pool.token0Price.toSignificant(18));
      } catch {
        // Fall through to poolState computation
      }
    }
    // Compute from poolState.sqrtPriceX96 for Unified Yield positions or fallback
    if (poolState && token0Config && token1Config && poolState.sqrtPriceX96 > 0n) {
      const sqrtPrice = Number(poolState.sqrtPriceX96) / 2 ** 96;
      const rawPrice = sqrtPrice * sqrtPrice;
      const decimalAdjustment = Math.pow(10, token0Config.decimals - token1Config.decimals);
      const price = rawPrice * decimalAdjustment;
      if (isFinite(price) && price > 0) return price;
    }
    return null;
  }, [pool, poolState, token0Config, token1Config]);

  // ============================================================================
  // Range Calculations using shared hooks
  // ============================================================================

  // Compute tick bounds (from position or pool config for Unified Yield)
  const { tickLower, tickUpper } = useMemo(() => {
    // For Unified Yield, use pool's rehypoRange or default to full range
    if (isUnifiedYieldPosition && poolConfig?.rehypoRange) {
      const isFullRangeCalc = poolConfig.rehypoRange.isFullRange ?? true;
      if (isFullRangeCalc) {
        return { tickLower: -887272, tickUpper: 887272 };
      }
      return {
        tickLower: parseInt(poolConfig.rehypoRange.min, 10),
        tickUpper: parseInt(poolConfig.rehypoRange.max, 10),
      };
    }

    // For V4 positions, use position tick bounds
    if (positionInfo) {
      return {
        tickLower: positionInfo.tickLower,
        tickUpper: positionInfo.tickUpper,
      };
    }

    // Default fallback
    return { tickLower: 0, tickUpper: 0 };
  }, [isUnifiedYieldPosition, poolConfig, positionInfo]);

  // Use price ordering hook (converts ticks to prices using SDK)
  const priceOrdering = usePriceOrdering({
    chainId,
    token0: {
      address: token0Config?.address ?? "0x0000000000000000000000000000000000000000",
      symbol: token0Config?.symbol ?? "",
      decimals: token0Config?.decimals ?? 18,
    },
    token1: {
      address: token1Config?.address ?? "0x0000000000000000000000000000000000000000",
      symbol: token1Config?.symbol ?? "",
      decimals: token1Config?.decimals ?? 18,
    },
    tickLower,
    tickUpper,
  });

  // Use range display hook for formatted min/max prices
  const {
    minPrice,
    maxPrice,
    tokenASymbol,
    tokenBSymbol,
    isFullRange,
  } = useGetRangeDisplay({
    priceOrdering,
    pricesInverted: priceInverted,
    tickSpacing: poolConfig?.tickSpacing,
    tickLower,
    tickUpper,
  });

  // Calculate isInRange separately (Unified Yield is always in range)
  const isInRange = useMemo(() => {
    if (isUnifiedYieldPosition) return true; // Unified Yield is managed, always in range
    if (!pool) return false;
    const currentTick = pool.tickCurrent;
    return currentTick >= tickLower && currentTick < tickUpper;
  }, [isUnifiedYieldPosition, pool, tickLower, tickUpper]);

  // Fetch pool APR from backend (fallback for pool-wide APR)
  const { data: poolStatsData } = useQuery({
    queryKey: ["poolStats", poolConfig?.subgraphId, networkMode],
    queryFn: async () => {
      const poolId = poolConfig?.subgraphId || "";
      // Fetch all pools and filter (backend only has /pools/metrics, not /pools/{id}/metrics)
      const response = await fetchPoolsMetrics(networkMode);
      if (!response.success || !response.pools) return null;
      const pool = response.pools.find(p => p.poolId.toLowerCase() === poolId.toLowerCase());
      if (!pool) return null;
      // Calculate APR same as WebSocket: (fees24h / tvl) * 365 * 100
      const apr = pool.tvlUsd > 0 ? (pool.fees24hUsd / pool.tvlUsd) * 365 * 100 : 0;
      return { apr };
    },
    enabled: !!poolConfig?.subgraphId,
    staleTime: 60_000, // Cache for 1 minute
  });

  // Fetch position-specific 7d APR from backend (primary source for position APR)
  const { data: backendAprData } = useQuery({
    queryKey: ["positionApr", tokenId, networkMode],
    queryFn: () => fetchPositionApr(tokenId, networkMode),
    enabled: !!tokenId,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // APR data - prefer backend position-specific APR, fallback to pool APR
  const poolApr = useMemo(() => {
    // Use backend position APR if available and has data
    if (backendAprData?.success && backendAprData.apr7d !== null && backendAprData.dataPoints > 0) {
      return backendAprData.apr7d; // Already a percentage value (e.g., 1.826 = 1.826%)
    }
    // Fallback to pool-wide APR
    return poolStatsData?.apr ?? null;
  }, [backendAprData, poolStatsData]);

  // Fetch Aave APY for rehypo positions
  const { data: aaveRatesData } = useQuery({
    queryKey: ["aaveRates"],
    queryFn: fetchAaveRates,
    enabled: lpType === "rehypo",
    staleTime: 5 * 60_000, // 5 minutes - matches backend cache
  });

  // Calculate Aave APY based on position tokens
  const aaveApr = useMemo(() => {
    if (lpType !== "rehypo" || !aaveRatesData?.success || !poolConfig) return null;

    const token0Symbol = poolConfig.currency0.symbol;
    const token1Symbol = poolConfig.currency1.symbol;
    const key0 = getAaveKey(token0Symbol);
    const key1 = getAaveKey(token1Symbol);

    const apy0 = key0 && aaveRatesData.data[key0] ? aaveRatesData.data[key0].apy : null;
    const apy1 = key1 && aaveRatesData.data[key1] ? aaveRatesData.data[key1].apy : null;

    // Average if both tokens supported, otherwise use single token's APY
    if (apy0 !== null && apy1 !== null) {
      return (apy0 + apy1) / 2;
    }
    return apy0 ?? apy1 ?? null;
  }, [lpType, aaveRatesData, poolConfig]);

  const totalApr = useMemo(() => {
    if (poolApr === null) return null;
    return poolApr + (aaveApr || 0);
  }, [poolApr, aaveApr]);

  // Chart data
  const { entries: chartData, loading: isLoadingChart } = usePoolPriceChartData({
    variables: {
      poolId: poolConfig?.subgraphId,
      duration: DURATION_MAP[chartDuration],
    },
    priceInverted,
  });

  // Denomination toggle
  const effectiveDenominationBase = denominationBase;
  const handleDenominationToggle = useCallback(() => {
    setDenominationBase((prev) => !prev);
    setPriceInverted((prev) => !prev);
  }, []);

  const isOwner = useMemo(() => {
    if (!address) return false;

    // For Unified Yield positions, check against the userAddress in the URL
    if (isUnifiedYieldPosition && unifiedYieldParsed) {
      return unifiedYieldParsed.userAddress.toLowerCase() === address.toLowerCase();
    }

    // Fallback: If we have a loaded UY position but parsing failed for some reason,
    // check if the tokenId contains the connected wallet address
    // This handles edge cases where URL parsing might fail unexpectedly
    if (tokenId.startsWith('uy-') && unifiedYieldPosition) {
      const addressLower = address.toLowerCase();
      return tokenId.toLowerCase().includes(addressLower);
    }

    // For V4 positions, check against the position owner
    if (!positionInfo?.owner) return false;
    return positionInfo.owner.toLowerCase() === address.toLowerCase();
  }, [address, positionInfo, isUnifiedYieldPosition, unifiedYieldParsed, tokenId, unifiedYieldPosition]);

  // Determine loading and error states
  const isLoading = isUnifiedYieldPosition
    ? isLoadingUnifiedYield
    : (isLoadingPosition || isLoadingPool);

  const error = isUnifiedYieldPosition
    ? (unifiedYieldError as Error | null)
    : (positionError as Error | null);

  return {
    // Position data
    position,
    positionInfo: positionInfo ?? null,
    unifiedYieldPosition: unifiedYieldPosition ?? null,
    isLoading,
    error,
    // Pool data
    poolConfig,
    poolState: poolState ?? null,
    // Token amounts
    currency0Amount,
    currency1Amount,
    // USD values
    fiatValue0,
    fiatValue1,
    totalPositionValue,
    // Fees
    fee0Amount,
    fee1Amount,
    fiatFeeValue0,
    fiatFeeValue1,
    totalFeesValue,
    // Price info
    currentPrice,
    currentPriceNumeric,
    priceInverted,
    setPriceInverted,
    // Range display
    minPrice,
    maxPrice,
    tokenASymbol,
    tokenBSymbol,
    isFullRange,
    isInRange,
    // APR data
    poolApr,
    aaveApr,
    totalApr,
    // LP Type
    lpType,
    // Chart
    chartDuration,
    setChartDuration,
    chartData,
    isLoadingChart,
    // Denomination
    effectiveDenominationBase,
    handleDenominationToggle,
    // Ownership
    isOwner,
    // Actions
    refetch,
  };
}
