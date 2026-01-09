/**
 * useRangeHopCallbacks - Tick-based price navigation for range inputs
 *
 * Copied from Uniswap's useRangeHopCallbacks pattern
 * @see interface/apps/web/src/state/mint/v3/hooks.tsx
 */

import { useCallback, useMemo } from 'react';

interface UseRangeHopCallbacksProps {
  tickLower: number | null | undefined;
  tickUpper: number | null | undefined;
  tickSpacing: number;
  poolCurrentTick?: number;
}

/**
 * Convert tick to price string (Uniswap pattern)
 * price = 1.0001^tick
 */
function tickToPrice(tick: number, significantDigits: number = 5): string {
  const price = Math.pow(1.0001, tick);

  // Format to significant digits (similar to SDK's toSignificant)
  if (price === 0) return '0';

  const magnitude = Math.floor(Math.log10(Math.abs(price)));
  const precision = significantDigits - 1 - magnitude;

  if (precision < 0) {
    return price.toFixed(0);
  }

  return price.toFixed(Math.min(precision, 20));
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
}: UseRangeHopCallbacksProps) {
  const getDecrementLower = useCallback(() => {
    if (typeof tickLower === 'number') {
      return tickToPrice(tickLower - tickSpacing);
    }
    // Use pool current tick as starting tick if we have pool but no tick input
    if (typeof poolCurrentTick === 'number') {
      return tickToPrice(poolCurrentTick - tickSpacing);
    }
    return '';
  }, [tickLower, tickSpacing, poolCurrentTick]);

  const getIncrementLower = useCallback(() => {
    if (typeof tickLower === 'number') {
      return tickToPrice(tickLower + tickSpacing);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPrice(poolCurrentTick + tickSpacing);
    }
    return '';
  }, [tickLower, tickSpacing, poolCurrentTick]);

  const getDecrementUpper = useCallback(() => {
    if (typeof tickUpper === 'number') {
      return tickToPrice(tickUpper - tickSpacing);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPrice(poolCurrentTick - tickSpacing);
    }
    return '';
  }, [tickUpper, tickSpacing, poolCurrentTick]);

  const getIncrementUpper = useCallback(() => {
    if (typeof tickUpper === 'number') {
      return tickToPrice(tickUpper + tickSpacing);
    }
    if (typeof poolCurrentTick === 'number') {
      return tickToPrice(poolCurrentTick + tickSpacing);
    }
    return '';
  }, [tickUpper, tickSpacing, poolCurrentTick]);

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
