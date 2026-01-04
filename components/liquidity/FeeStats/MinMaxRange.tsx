/**
 * MinMaxRange
 *
 * Displays min/max price range.
 * Uses pre-formatted prices from useGetRangeDisplay which uses significant digits.
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { FeeStat } from './FeeStat';

interface MinMaxRangeProps {
  /** Pool tick spacing */
  tickSpacing?: number;
  /** Position lower tick */
  tickLower?: number;
  /** Position upper tick */
  tickUpper?: number;
  /** Whether prices are inverted */
  pricesInverted: boolean;
  /** Setter for price inversion toggle */
  setPricesInverted: React.Dispatch<React.SetStateAction<boolean>>;
  /** Pool type for decimal formatting */
  poolType?: string;
  /** Denomination base token */
  denominationBase?: string;
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
  // Use pre-formatted values directly - they already use significant digits
  const minPrice = formattedMinPrice ?? '-';
  const maxPrice = formattedMaxPrice ?? '-';
  const isFullRange = isFullRangeProp ?? false;

  // Full range case - mirrors Uniswap's full range display
  if (isFullRange) {
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
        {minPrice} - {maxPrice}
      </span>
      <span className="text-xs text-muted-foreground">Range</span>
    </FeeStat>
  );
}
