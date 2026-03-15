/**
 * MinMaxRange
 *
 * Displays min/max price range.
 * Uses pre-formatted prices from useGetRangeDisplay which uses significant digits.
 */

"use client"

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { FeeStat } from './FeeStat';

// Thresholds for detecting full range edge cases
// These match typical MIN_TICK/MAX_TICK price boundaries
const MIN_PRICE_THRESHOLD = 1e-20;
const MAX_PRICE_THRESHOLD = 1e30;

interface MinMaxRangeProps {
  /** Pre-formatted min price (from useGetRangeDisplay with significant digits) */
  formattedMinPrice?: string;
  /** Pre-formatted max price (from useGetRangeDisplay with significant digits) */
  formattedMaxPrice?: string;
  /** Whether this is a full range position */
  isFullRange?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * MinMaxRange component.
 * Displays price range using pre-formatted prices from useGetRangeDisplay.
 *
 * The prices are already formatted using toSignificant() which provides
 * appropriate precision for all token pairs (including stablecoins).
 */
export function MinMaxRange({
  formattedMinPrice,
  formattedMaxPrice,
  isFullRange: isFullRangeProp,
  className,
}: MinMaxRangeProps) {
  // Parse numeric values to detect edge cases
  const { displayMin, displayMax, effectiveFullRange } = useMemo(() => {
    const minNum = formattedMinPrice ? parseFloat(formattedMinPrice) : null;
    const maxNum = formattedMaxPrice ? parseFloat(formattedMaxPrice) : null;

    // Detect full range by extreme values (fallback when isFullRange detection fails)
    const isMinExtreme = minNum !== null && (minNum < MIN_PRICE_THRESHOLD || !isFinite(minNum));
    const isMaxExtreme = maxNum !== null && (maxNum > MAX_PRICE_THRESHOLD || !isFinite(maxNum));
    const effectiveFullRange = isFullRangeProp || (isMinExtreme && isMaxExtreme);

    // Format display values with edge case handling
    const displayMin = isMinExtreme ? '0' : (formattedMinPrice ?? '-');
    const displayMax = isMaxExtreme ? '∞' : (formattedMaxPrice ?? '-');

    return { displayMin, displayMax, effectiveFullRange };
  }, [formattedMinPrice, formattedMaxPrice, isFullRangeProp]);

  // Full range case - mirrors Uniswap's full range display
  if (effectiveFullRange) {
    return (
      <FeeStat className={cn("hidden lg:flex", className)}>
        <span className="text-sm font-medium font-mono">Full range</span>
        <span className="text-xs text-muted-foreground">Range</span>
      </FeeStat>
    );
  }

  // Bounded range - mirrors Uniswap's min/max display
  return (
    <FeeStat className={cn("hidden lg:flex", className)}>
      <span className="text-sm text-foreground truncate font-mono">
        {displayMin} - {displayMax}
      </span>
      <span className="text-xs text-muted-foreground">Range</span>
    </FeeStat>
  );
}
