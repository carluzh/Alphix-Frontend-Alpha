"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { CurrencyAmount, Token, Price, Currency } from "@uniswap/sdk-core";
import { Pool as V4Pool, Position as V4Position, tickToPrice } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import { getAddress } from "viem";
import { getAllPools, getToken, type PoolConfig, type TokenConfig } from "@/lib/pools-config";
import { useUSDCPriceRaw } from "@/lib/uniswap/hooks/useUSDCPrice";
import { usePoolPriceChartData } from "@/lib/chart/hooks/usePoolPriceChartData";
import { HistoryDuration } from "@/lib/chart/types";
import { useNetwork } from "@/lib/network-context";
import { fetchAaveRates, getAaveKey } from "@/lib/aave-rates";
import { fetchPositionApr } from "@/lib/backend-client";

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
  priceInverted: boolean;
  setPriceInverted: (inverted: boolean) => void;
  // Range display
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  isFullRange: boolean;
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
  if (!tokenId) return null;

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
  const [priceInverted, setPriceInverted] = useState(false);
  const [chartDuration, setChartDuration] = useState<ChartDuration>("1M");
  const [denominationBase, setDenominationBase] = useState(true);

  // Fetch position info
  const {
    data: positionInfo,
    isLoading: isLoadingPosition,
    error: positionError,
    refetch,
  } = useQuery({
    queryKey: ["position", tokenId],
    queryFn: () => fetchPosition(tokenId),
    enabled: !!tokenId,
    staleTime: 30_000,
  });

  // Get pool config from position info
  const poolConfig = useMemo((): PoolConfig | null => {
    if (!positionInfo) return null;

    const allPools = getAllPools();
    // Find matching pool config by token addresses
    const config = allPools.find(
      (pool) =>
        (pool.currency0.address.toLowerCase() === positionInfo.token0.toLowerCase() &&
          pool.currency1.address.toLowerCase() === positionInfo.token1.toLowerCase()) ||
        (pool.currency0.address.toLowerCase() === positionInfo.token1.toLowerCase() &&
          pool.currency1.address.toLowerCase() === positionInfo.token0.toLowerCase())
    );
    return config || null;
  }, [positionInfo]);

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
  const lpType: LPType = useMemo(() => {
    if (!poolConfig) return "concentrated";
    return poolConfig.rehypoRange ? "rehypo" : "concentrated";
  }, [poolConfig]);

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

  // Token amounts from position
  const currency0Amount = position?.amount0 || null;
  const currency1Amount = position?.amount1 || null;

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

  // Fee amounts
  const fee0Amount = useMemo(() => {
    if (!positionInfo || !token0Config) return null;
    const token0 = new Token(
      chainId,
      token0Config.address,
      token0Config.decimals,
      token0Config.symbol
    );
    return CurrencyAmount.fromRawAmount(token0, positionInfo.tokensOwed0.toString());
  }, [positionInfo, token0Config, chainId]);

  const fee1Amount = useMemo(() => {
    if (!positionInfo || !token1Config) return null;
    const token1 = new Token(
      chainId,
      token1Config.address,
      token1Config.decimals,
      token1Config.symbol
    );
    return CurrencyAmount.fromRawAmount(token1, positionInfo.tokensOwed1.toString());
  }, [positionInfo, token1Config, chainId]);

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

  // Current price
  const currentPrice = pool?.token0Price || null;

  // Range calculations
  const { minPrice, maxPrice, tokenASymbol, tokenBSymbol, isFullRange, isInRange } = useMemo(() => {
    if (!position || !pool || !poolConfig) {
      return {
        minPrice: "0",
        maxPrice: "∞",
        tokenASymbol: "",
        tokenBSymbol: "",
        isFullRange: false,
        isInRange: false,
      };
    }

    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const currentTick = pool.tickCurrent;

    const priceLower = tickToPrice(pool.token0, pool.token1, tickLower);
    const priceUpper = tickToPrice(pool.token0, pool.token1, tickUpper);

    const isFullRangeCalc =
      tickLower === -887272 && tickUpper === 887272; // Near min/max ticks

    const isInRangeCalc = currentTick >= tickLower && currentTick < tickUpper;

    return {
      minPrice: priceInverted ? priceUpper.invert().toSignificant(6) : priceLower.toSignificant(6),
      maxPrice: priceInverted ? priceLower.invert().toSignificant(6) : priceUpper.toSignificant(6),
      tokenASymbol: priceInverted ? poolConfig.currency1.symbol : poolConfig.currency0.symbol,
      tokenBSymbol: priceInverted ? poolConfig.currency0.symbol : poolConfig.currency1.symbol,
      isFullRange: isFullRangeCalc,
      isInRange: isInRangeCalc,
    };
  }, [position, pool, poolConfig, priceInverted]);

  // Fetch pool APR from pools batch endpoint (fallback for pool-wide APR)
  const { data: poolStatsData } = useQuery({
    queryKey: ["poolStats", poolConfig?.subgraphId, networkMode],
    queryFn: async () => {
      const resp = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      const pools = Array.isArray(data?.pools) ? data.pools : [];
      const poolIdLc = (poolConfig?.subgraphId || "").toLowerCase();
      const match = pools.find((p: { poolId?: string }) =>
        String(p.poolId || "").toLowerCase() === poolIdLc
      );
      return match ? { apr: Number(match.apr) || 0 } : null;
    },
    enabled: !!poolConfig?.subgraphId,
    staleTime: 60_000, // Cache for 1 minute
  });

  // Fetch position-specific 7d APR from backend (primary source for position APR)
  const { data: backendAprData } = useQuery({
    queryKey: ["positionApr", tokenId],
    queryFn: () => fetchPositionApr(tokenId),
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
    if (!address || !positionInfo?.owner) return false;
    return positionInfo.owner.toLowerCase() === address.toLowerCase();
  }, [address, positionInfo]);

  return {
    // Position data
    position,
    positionInfo: positionInfo ?? null,
    isLoading: isLoadingPosition || isLoadingPool,
    error: positionError as Error | null,
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
