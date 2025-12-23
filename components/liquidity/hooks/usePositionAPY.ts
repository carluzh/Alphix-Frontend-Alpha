/**
 * usePositionAPY Hook
 *
 * Handles APY calculation for liquidity positions.
 * Fetches pool metrics and calculates estimated APY based on position parameters.
 */

import { useState, useEffect, useRef } from 'react';
import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { getAddress } from 'viem';
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from '@/lib/swap-constants';
import { getPoolById, getTokenDefinitions, TokenSymbol, NetworkMode } from '@/lib/pools-config';
import {
  calculateUserPositionAPY,
  calculatePositionAPY,
  formatUserAPY,
  type PoolMetrics,
} from '@/lib/apy-calculator';
import { CalculatedLiquidityData } from './useAddLiquidityCalculation';

export interface CachedPoolMetrics {
  poolId: string;
  metrics: PoolMetrics | null;
  poolLiquidity: string;
}

export interface UsePositionAPYParams {
  selectedPoolId?: string;
  tickLower: string;
  tickUpper: string;
  currentPoolTick: number | null;
  currentPoolSqrtPriceX96: string | null;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  calculatedData: CalculatedLiquidityData | null;
  poolLiquidity?: string;
  chainId: number;
  networkMode: NetworkMode;
}

export interface UsePositionAPYResult {
  /** Formatted APY string for display */
  estimatedApy: string;
  /** Whether APY calculation is in progress */
  isCalculatingApy: boolean;
  /** Cached pool metrics data (also used by RangeSelectionModal) */
  cachedPoolMetrics: CachedPoolMetrics | null;
}

/**
 * Hook for calculating position APY.
 */
export function usePositionAPY(params: UsePositionAPYParams): UsePositionAPYResult {
  const {
    selectedPoolId,
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    poolLiquidity,
    chainId,
    networkMode,
  } = params;

  const [estimatedApy, setEstimatedApy] = useState<string>('0.00');
  const [isCalculating, setIsCalculating] = useState(false);
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<CachedPoolMetrics | null>(null);
  const fetchedPoolMetricsRef = useRef<string | null>(null);

  const tokenDefinitions = getTokenDefinitions(networkMode);

  // Derived validation - single source of truth for "can we calculate"
  const lowerTick = parseInt(tickLower);
  const upperTick = parseInt(tickUpper);
  const hasValidInputs = !!(
    selectedPoolId &&
    tickLower &&
    tickUpper &&
    currentPoolSqrtPriceX96 &&
    currentPoolTick !== null &&
    poolLiquidity &&
    !isNaN(lowerTick) &&
    !isNaN(upperTick) &&
    lowerTick < upperTick
  );
  const hasMetrics = !!(cachedPoolMetrics?.poolId === selectedPoolId && cachedPoolMetrics?.metrics?.days);
  const isWaitingForMetrics = hasValidInputs && !hasMetrics;

  // Fetch pool metrics (cached per pool)
  useEffect(() => {
    if (!selectedPoolId || !poolLiquidity) return;
    if (fetchedPoolMetricsRef.current === selectedPoolId) return;

    fetchedPoolMetricsRef.current = selectedPoolId;

    (async () => {
      try {
        const resp = await fetch('/api/liquidity/pool-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId: selectedPoolId, days: 7 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setCachedPoolMetrics({
            poolId: selectedPoolId,
            metrics: data.metrics,
            poolLiquidity: poolLiquidity,
          });
        }
      } catch {
        fetchedPoolMetricsRef.current = null;
      }
    })();
  }, [selectedPoolId, poolLiquidity]);

  // APY calculation
  useEffect(() => {
    if (!hasValidInputs || !hasMetrics) {
      setEstimatedApy(hasValidInputs && cachedPoolMetrics?.metrics?.days === 0 ? '—' : '0.00');
      setIsCalculating(false);
      return;
    }

    setIsCalculating(true);

    const calculate = async () => {
      try {
        const poolConfig = getPoolById(selectedPoolId!);
        const token0Def = tokenDefinitions[token0Symbol];
        const token1Def = tokenDefinitions[token1Symbol];

        if (!poolConfig || !token0Def || !token1Def) {
          setEstimatedApy('—');
          return;
        }

        const sdkPool = new V4PoolSDK(
          new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Symbol, token0Symbol),
          new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Symbol, token1Symbol),
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS,
          JSBI.BigInt(currentPoolSqrtPriceX96!),
          JSBI.BigInt(cachedPoolMetrics!.poolLiquidity),
          currentPoolTick!
        );

        const useDefaultAmount = parseFloat(amount0 || '0') <= 0 && parseFloat(amount1 || '0') <= 0;
        const apy = useDefaultAmount
          ? await calculatePositionAPY(sdkPool, lowerTick, upperTick, cachedPoolMetrics!.metrics as PoolMetrics, 100)
          : await calculateUserPositionAPY(sdkPool, lowerTick, upperTick, amount0, amount1, cachedPoolMetrics!.metrics as PoolMetrics, calculatedData?.liquidity);

        setEstimatedApy(formatUserAPY(apy));
      } catch {
        setEstimatedApy('—');
      } finally {
        setIsCalculating(false);
      }
    };

    const timer = setTimeout(calculate, 200);
    return () => clearTimeout(timer);
  }, [hasValidInputs, hasMetrics, selectedPoolId, lowerTick, upperTick, currentPoolSqrtPriceX96, currentPoolTick, token0Symbol, token1Symbol, amount0, amount1, calculatedData, cachedPoolMetrics, chainId, tokenDefinitions]);

  // Derive loading state: calculating OR waiting for metrics to load
  const isCalculatingApy = isCalculating || isWaitingForMetrics;

  return {
    estimatedApy,
    isCalculatingApy,
    cachedPoolMetrics,
  };
}
