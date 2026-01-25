/**
 * useRangeHopCallbacks - Tick-based price navigation for range inputs
 *
 * Copied from Uniswap's useRangeHopCallbacks pattern
 * @see interface/apps/web/src/state/mint/v3/hooks.tsx
 *
 * Uses consolidated tick-price utilities for proper decimal handling.
 */

import { useCallback, useMemo } from 'react';
import type { Token, Currency } from '@uniswap/sdk-core';
import { tickToPriceSmart } from '@/lib/liquidity/utils/tick-price';

interface UseRangeHopCallbacksProps {
  tickLower: number | null | undefined;
  tickUpper: number | null | undefined;
  tickSpacing: number;
  poolCurrentTick?: number;
  /** Token0 from the pool - needed for proper decimal handling */
  token0?: Token | Currency;
  /** Token1 from the pool - needed for proper decimal handling */
  token1?: Token | Currency;
}

/**
 * Hook that returns increment/decrement functions for range inputs
 * Returns new price strings when called (Uniswap pattern)
 */
export function useRangeHopCallbacks({
  tickLower,
  tickUpper,
  tickSpacing,
  poolCurrentTick,
  token0,
  token1,
}: UseRangeHopCallbacksProps) {
  const getDecrementLower = useCallback(() => {
    if (typeof tickLower === 'number') {
      return tickToPriceSmart(tickLower - tickSpacing, token0, token1);
    }
    // Use pool current tick as starting tick if we have pool but no tick input
    if (typeof poolCurrentTick === 'number') {
      return tickToPriceSmart(poolCurrentTick - tickSpacing, token0, token1);
    }
    return '';
  }, [tickLower, tickSpacing, poolCurrentTick, token0, token1]);

  const getIncrementLower = useCallback(() => {
    if (typeof tickLower === 'number') {
      return tickToPriceSmart(tickLower + tickSpacing, token0, token1);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPriceSmart(poolCurrentTick + tickSpacing, token0, token1);
    }
    return '';
  }, [tickLower, tickSpacing, poolCurrentTick, token0, token1]);

  const getDecrementUpper = useCallback(() => {
    if (typeof tickUpper === 'number') {
      return tickToPriceSmart(tickUpper - tickSpacing, token0, token1);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPriceSmart(poolCurrentTick - tickSpacing, token0, token1);
    }
    return '';
  }, [tickUpper, tickSpacing, poolCurrentTick, token0, token1]);

  const getIncrementUpper = useCallback(() => {
    if (typeof tickUpper === 'number') {
      return tickToPriceSmart(tickUpper + tickSpacing, token0, token1);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPriceSmart(poolCurrentTick + tickSpacing, token0, token1);
    }
    return '';
  }, [tickUpper, tickSpacing, poolCurrentTick, token0, token1]);

  return useMemo(
    () => ({
      getDecrementLower,
      getIncrementLower,
      getDecrementUpper,
      getIncrementUpper,
    }),
    [getDecrementLower, getIncrementLower, getDecrementUpper, getIncrementUpper]
  );
}
