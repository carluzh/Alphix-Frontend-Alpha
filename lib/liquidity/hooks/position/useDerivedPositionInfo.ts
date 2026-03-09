/**
 * useDerivedPositionInfo - Derive position information from user inputs
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/Create/hooks/useDerivedPositionInfo.tsx
 *
 * Simplified for Alphix (V4 only, pre-configured pools).
 */

import { useMemo, useCallback } from 'react';
import { Token, Currency } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';

import { getPoolById, getToken, getChainId, type PoolConfig, type NetworkMode } from '../../../pools-config';
import { PositionField, type CreatePositionInfo, type PositionState, type FeeData } from '../../types';

// =============================================================================
// CURRENCY SORTING - Matches Uniswap's getSortedCurrencies
// =============================================================================

/**
 * Sort currencies for V4 pools.
 * Native tokens come first, otherwise sort by address.
 */
function getSortedCurrencies(
  a: Currency | undefined,
  b: Currency | undefined
): { [key in PositionField]: Currency | undefined } {
  if (!a || !b) {
    return { TOKEN0: a, TOKEN1: b };
  }

  if (a.isNative) {
    return { TOKEN0: a, TOKEN1: b };
  }

  if (b.isNative) {
    return { TOKEN0: b, TOKEN1: a };
  }

  // Use wrapped tokens for sortsBefore comparison
  const wrappedA = a.wrapped;
  const wrappedB = b.wrapped;

  return wrappedA.sortsBefore(wrappedB) ? { TOKEN0: a, TOKEN1: b } : { TOKEN0: b, TOKEN1: a };
}

// =============================================================================
// POOL CONSTRUCTION - Build V4Pool from pool config and state
// =============================================================================

interface PoolStateData {
  sqrtPriceX96: string;
  currentTick: number;
  liquidity: string;
}

/**
 * Construct a V4Pool SDK instance from pool config and on-chain state.
 */
function buildV4Pool(
  poolConfig: PoolConfig,
  poolState: PoolStateData,
  chainId: number,
  networkMode?: NetworkMode
): V4Pool | undefined {
  try {
    const token0Config = getToken(poolConfig.currency0.symbol, networkMode);
    const token1Config = getToken(poolConfig.currency1.symbol, networkMode);

    if (!token0Config || !token1Config) {
      console.warn('[buildV4Pool] Token config not found');
      return undefined;
    }

    const token0 = new Token(
      chainId,
      token0Config.address as `0x${string}`,
      token0Config.decimals,
      token0Config.symbol,
      token0Config.name
    );

    const token1 = new Token(
      chainId,
      token1Config.address as `0x${string}`,
      token1Config.decimals,
      token1Config.symbol,
      token1Config.name
    );

    return new V4Pool(
      token0,
      token1,
      poolConfig.fee,
      poolConfig.tickSpacing,
      poolConfig.hooks,
      JSBI.BigInt(poolState.sqrtPriceX96),
      JSBI.BigInt(poolState.liquidity || '0'),
      poolState.currentTick
    );
  } catch (error) {
    console.error('[buildV4Pool] Failed to construct pool:', error);
    return undefined;
  }
}

// =============================================================================
// HOOK: useDerivedPositionInfo
// =============================================================================

export interface UseDerivedPositionInfoParams {
  /** Selected pool ID */
  poolId?: string;
  /** Pool state from on-chain data */
  poolState?: PoolStateData;
  /** Chain ID (optional, defaults to config) */
  chainId?: number;
  /** Network mode for chain-specific config lookups */
  networkMode?: NetworkMode;
}

/**
 * useDerivedPositionInfo - Derives position information from pool selection.
 *
 * This is a simplified version for Alphix that works with pre-configured pools.
 *
 * @param params - Pool ID and state data
 * @returns CreatePositionInfo with currencies, pool, and loading state
 */
export function useDerivedPositionInfo(
  params: UseDerivedPositionInfoParams
): CreatePositionInfo {
  const { poolId, poolState, chainId: chainIdOverride, networkMode } = params;
  const chainId = chainIdOverride ?? getChainId(networkMode);

  // Get pool configuration
  const poolConfig = useMemo(() => {
    if (!poolId) return undefined;
    return getPoolById(poolId, networkMode);
  }, [poolId, networkMode]);

  // Build Token instances
  const currencies = useMemo(() => {
    if (!poolConfig) {
      return {
        display: { TOKEN0: undefined, TOKEN1: undefined },
        sdk: { TOKEN0: undefined, TOKEN1: undefined },
      };
    }

    const token0Config = getToken(poolConfig.currency0.symbol, networkMode);
    const token1Config = getToken(poolConfig.currency1.symbol, networkMode);

    if (!token0Config || !token1Config) {
      return {
        display: { TOKEN0: undefined, TOKEN1: undefined },
        sdk: { TOKEN0: undefined, TOKEN1: undefined },
      };
    }

    const token0 = new Token(
      chainId,
      token0Config.address as `0x${string}`,
      token0Config.decimals,
      token0Config.symbol,
      token0Config.name
    );

    const token1 = new Token(
      chainId,
      token1Config.address as `0x${string}`,
      token1Config.decimals,
      token1Config.symbol,
      token1Config.name
    );

    const sorted = getSortedCurrencies(token0, token1);

    return {
      display: sorted,
      sdk: sorted,
    };
  }, [poolConfig, chainId, networkMode]);

  // Build V4Pool instance
  const pool = useMemo(() => {
    if (!poolConfig || !poolState) {
      return undefined;
    }

    return buildV4Pool(poolConfig, poolState, chainId, networkMode);
  }, [poolConfig, poolState, chainId, networkMode]);

  // Refetch function (no-op for now, pool state comes from parent)
  const refetchPoolData = useCallback(() => {
    // Pool state is managed externally in Alphix
    // This is kept for API compatibility with Uniswap
  }, []);

  // Loading state
  const poolOrPairLoading = !poolState && !!poolId;

  // Creating new pool (Alphix pools are pre-deployed, so always false)
  const creatingPoolOrPair = false;

  return useMemo(
    () => ({
      currencies,
      pool,
      poolId,
      creatingPoolOrPair,
      poolOrPairLoading,
      refetchPoolData,
    }),
    [currencies, pool, poolId, creatingPoolOrPair, poolOrPairLoading, refetchPoolData]
  );
}

// =============================================================================
// HOOK: useDerivedPositionInfoFromState
// =============================================================================

/**
 * Alternative hook that derives position info from PositionState.
 * Matches Uniswap's useDerivedPositionInfo signature more closely.
 */
export function useDerivedPositionInfoFromState(
  currencyInputs: { tokenA: Currency | undefined; tokenB: Currency | undefined },
  state: PositionState & { poolState?: PoolStateData },
  poolId?: string,
  networkMode?: NetworkMode
): CreatePositionInfo {
  const { tokenA, tokenB } = currencyInputs;
  const chainId = getChainId(networkMode);

  // Sort currencies
  const sortedCurrencies = useMemo(() => {
    return getSortedCurrencies(tokenA, tokenB);
  }, [tokenA, tokenB]);

  // Get pool configuration
  const poolConfig = useMemo(() => {
    if (!poolId) return undefined;
    return getPoolById(poolId, networkMode);
  }, [poolId, networkMode]);

  // Build V4Pool instance
  const pool = useMemo(() => {
    if (!poolConfig || !state.poolState) {
      return undefined;
    }

    return buildV4Pool(poolConfig, state.poolState, chainId, networkMode);
  }, [poolConfig, state.poolState, chainId, networkMode]);

  // Refetch function
  const refetchPoolData = useCallback(() => {
    // Pool state is managed externally
  }, []);

  return useMemo(
    () => ({
      currencies: {
        display: sortedCurrencies,
        sdk: sortedCurrencies,
      },
      pool,
      poolId,
      creatingPoolOrPair: false,
      poolOrPairLoading: !state.poolState && !!poolId,
      refetchPoolData,
    }),
    [sortedCurrencies, pool, poolId, state.poolState, refetchPoolData]
  );
}

// =============================================================================
// HELPER: Get fee data from pool config
// =============================================================================

/**
 * Extract FeeData from a pool configuration.
 */
export function getFeeDataFromPool(poolConfig: PoolConfig | undefined): FeeData | undefined {
  if (!poolConfig) return undefined;

  return {
    feeAmount: poolConfig.fee,
    tickSpacing: poolConfig.tickSpacing,
    isDynamic: false, // Alphix pools use static fees
  };
}
