/**
 * Hook to calculate position-specific APR for a liquidity position
 * Uses the same calculation logic as RangeSelectionModalV2 but for existing positions
 */

import { useState, useEffect } from 'react';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import { Token } from '@uniswap/sdk-core';
import JSBI from 'jsbi';
import { calculatePositionAPY, type PoolMetrics } from '@/lib/apy-calculator';
import { getToken, getPoolById } from '@/lib/pools-config';

interface UsePositionAPRProps {
  poolId: string;
  chainId: number;
  tickLower: number;
  tickUpper: number;
  token0Symbol: string;
  token1Symbol: string;
  currentPoolTick: number | null;
  currentPoolSqrtPriceX96: string | null;
  poolLiquidity: string | null;
  enabled?: boolean;
}

interface UsePositionAPRResult {
  apr: number | null;
  isLoading: boolean;
  error: Error | null;
}

export function usePositionAPR({
  poolId,
  chainId,
  tickLower,
  tickUpper,
  token0Symbol,
  token1Symbol,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  poolLiquidity,
  enabled = true
}: UsePositionAPRProps): UsePositionAPRResult {
  const [apr, setApr] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Don't calculate if we don't have required data
    if (!currentPoolTick || !currentPoolSqrtPriceX96 || !poolLiquidity) {
      setApr(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const calculateAPR = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch pool metrics from API
        const response = await fetch('/api/liquidity/pool-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId, days: 7 })
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch pool metrics: ${response.status}`);
        }

        const data = await response.json();

        if (!data.metrics || data.metrics.days === 0) {
          if (isMounted) {
            setApr(0);
            setIsLoading(false);
          }
          return;
        }

        const poolMetrics: PoolMetrics = {
          totalFeesToken0: data.metrics.totalFeesToken0,
          avgTVLToken0: data.metrics.avgTVLToken0,
          days: data.metrics.days
        };

        // Get pool configuration for fee, tickSpacing, and hooks
        const poolConfig = getPoolById(poolId);

        if (!poolConfig) {
          throw new Error(`Pool configuration not found for poolId: ${poolId}`);
        }

        // Get token configurations
        const token0Config = getToken(token0Symbol as any);
        const token1Config = getToken(token1Symbol as any);

        if (!token0Config || !token1Config) {
          throw new Error('Token configuration not found');
        }

        // Create SDK Token instances
        const token0 = new Token(
          chainId,
          token0Config.address,
          token0Config.decimals,
          token0Symbol,
          token0Symbol
        );

        const token1 = new Token(
          chainId,
          token1Config.address,
          token1Config.decimals,
          token1Symbol,
          token1Symbol
        );

        // Create SDK Pool instance with correct pool-level properties
        const pool = new V4Pool(
          token0,
          token1,
          poolConfig.fee,
          poolConfig.tickSpacing,
          poolConfig.hooks,
          JSBI.BigInt(currentPoolSqrtPriceX96),
          JSBI.BigInt(poolLiquidity),
          currentPoolTick
        );

        // Calculate position-specific APR
        const calculatedAPR = await calculatePositionAPY(
          pool,
          tickLower,
          tickUpper,
          poolMetrics,
          100 // Use $100 USD as standard investment amount for calculation
        );

        if (isMounted) {
          setApr(calculatedAPR);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[usePositionAPR] Error calculating APR:', err);
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Unknown error'));
          setApr(null);
          setIsLoading(false);
        }
      }
    };

    calculateAPR();

    return () => {
      isMounted = false;
    };
  }, [
    enabled,
    poolId,
    chainId,
    tickLower,
    tickUpper,
    token0Symbol,
    token1Symbol,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    poolLiquidity
  ]);

  return { apr, isLoading, error };
}
