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
  const [isCalculatingApy, setIsCalculatingApy] = useState(false);
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<CachedPoolMetrics | null>(null);
  const fetchedPoolMetricsRef = useRef<string | null>(null);

  const tokenDefinitions = getTokenDefinitions(networkMode);

  // Fetch pool metrics for APY calculation (cached per pool)
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

  // APY calculation effect
  useEffect(() => {
    // Early validation - don't show loading for invalid states
    if (!selectedPoolId || !tickLower || !tickUpper || !currentPoolSqrtPriceX96 || currentPoolTick === null) {
      setEstimatedApy('0.00');
      setIsCalculatingApy(false);
      return;
    }

    const lowerTick = parseInt(tickLower);
    const upperTick = parseInt(tickUpper);

    if (isNaN(lowerTick) || isNaN(upperTick) || lowerTick >= upperTick) {
      setEstimatedApy('0.00');
      setIsCalculatingApy(false);
      return;
    }

    if (!cachedPoolMetrics || cachedPoolMetrics.poolId !== selectedPoolId) {
      setIsCalculatingApy(true);
      return;
    }

    if (!cachedPoolMetrics.metrics || cachedPoolMetrics.metrics.days === 0) {
      setEstimatedApy('—');
      setIsCalculatingApy(false);
      return;
    }

    // Only show loading and calculate for valid states
    setIsCalculatingApy(true);

    const calculateApy = async () => {
      try {
        const poolConfig = getPoolById(selectedPoolId);
        if (!poolConfig) {
          setEstimatedApy('—');
          setIsCalculatingApy(false);
          return;
        }

        const token0Def = tokenDefinitions[token0Symbol];
        const token1Def = tokenDefinitions[token1Symbol];

        if (!token0Def || !token1Def) {
          setEstimatedApy('—');
          setIsCalculatingApy(false);
          return;
        }

        const sdkToken0 = new Token(
          chainId,
          getAddress(token0Def.address),
          token0Def.decimals,
          token0Symbol,
          token0Symbol
        );
        const sdkToken1 = new Token(
          chainId,
          getAddress(token1Def.address),
          token1Def.decimals,
          token1Symbol,
          token1Symbol
        );

        const sdkPool = new V4PoolSDK(
          sdkToken0,
          sdkToken1,
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS,
          JSBI.BigInt(currentPoolSqrtPriceX96),
          JSBI.BigInt(cachedPoolMetrics.poolLiquidity),
          currentPoolTick
        );

        const amount0Num = parseFloat(amount0 || '0');
        const amount1Num = parseFloat(amount1 || '0');
        const useDefaultAmount = amount0Num <= 0 && amount1Num <= 0;

        let apy: number;

        if (useDefaultAmount) {
          apy = await calculatePositionAPY(
            sdkPool,
            lowerTick,
            upperTick,
            cachedPoolMetrics.metrics as PoolMetrics,
            100
          );
        } else {
          const userLiquidity = calculatedData?.liquidity;
          apy = await calculateUserPositionAPY(
            sdkPool,
            lowerTick,
            upperTick,
            amount0,
            amount1,
            cachedPoolMetrics.metrics as PoolMetrics,
            userLiquidity
          );
        }

        setEstimatedApy(formatUserAPY(apy));
      } catch {
        setEstimatedApy('—');
      } finally {
        setIsCalculatingApy(false);
      }
    };

    const timer = setTimeout(calculateApy, 200);
    return () => clearTimeout(timer);
  }, [
    selectedPoolId,
    tickLower,
    tickUpper,
    currentPoolSqrtPriceX96,
    currentPoolTick,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    cachedPoolMetrics,
    chainId,
    tokenDefinitions,
  ]);

  return {
    estimatedApy,
    isCalculatingApy,
    cachedPoolMetrics,
  };
}
