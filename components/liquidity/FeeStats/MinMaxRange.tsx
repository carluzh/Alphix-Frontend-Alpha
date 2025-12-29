/**
 * MinMaxRange
 *
 * Displays min/max price range with optional price inversion toggle.
 * Mirrors Uniswap's MinMaxRange from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 188-265)
 *
 * Can work with either:
 * 1. Pre-formatted prices (minPrice, maxPrice strings from parent)
 * 2. useGetRangeDisplay hook (when priceOrdering contains SDK Price objects)
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { FeeStat } from './FeeStat';
import {
  useGetRangeDisplay,
  getRangeDisplay,
  type PriceOrdering,
} from '@/lib/liquidity/hooks/range';
import { getDecimalsForDenomination } from '@/lib/denomination-utils';

// =============================================================================
// TYPES
// =============================================================================

interface MinMaxRangeProps {
  /** Price ordering with bounds and currencies (for useGetRangeDisplay) */
  priceOrdering?: PriceOrdering;
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
  /** Pre-formatted min price (when not using SDK Price objects) */
  formattedMinPrice?: string;
  /** Pre-formatted max price (when not using SDK Price objects) */
  formattedMaxPrice?: string;
  /** Whether this is a full range position */
  isFullRange?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format price for display with appropriate decimals.
 * Mirrors formatting logic from PositionCardCompact.
 */
function formatPriceForDisplay(
  price: string,
  decimals: number
): string {
  const v = parseFloat(price);
  if (!isFinite(v)) return '∞';
  if (price === '0') return '0';

  const threshold = Math.pow(10, -decimals);
  if (v > 0 && v < threshold) return `<${threshold.toFixed(decimals)}`;

  const formatted = v.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.min(2, decimals)
  });

  if (formatted === '0.00' && v > 0) return `<${threshold.toFixed(decimals)}`;

  return formatted;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * MinMaxRange component.
 * Displays price range with toggle for price inversion.
 *
 * Mirrors Uniswap's MinMaxRange:
 * - Full range: displays "Full range" text
 * - Bounded: displays "min - max" with token symbols
 * - Toggle icon shown on hover (desktop only)
 *
 * Responsive: Hidden on mobile (lg:flex pattern from current implementation)
 *
 * @example
 * ```tsx
 * // With pre-formatted prices
 * <MinMaxRange
 *   formattedMinPrice="1,234.56"
 *   formattedMaxPrice="5,678.90"
 *   isFullRange={false}
 *   pricesInverted={pricesInverted}
 *   setPricesInverted={setPricesInverted}
 *   poolType="volatile"
 *   denominationBase="USDC"
 * />
 *
 * // With useGetRangeDisplay
 * <MinMaxRange
 *   priceOrdering={priceOrdering}
 *   tickSpacing={tickSpacing}
 *   tickLower={tickLower}
 *   tickUpper={tickUpper}
 *   pricesInverted={pricesInverted}
 *   setPricesInverted={setPricesInverted}
 * />
 * ```
 */
export function MinMaxRange({
  priceOrdering,
  tickSpacing,
  tickLower,
  tickUpper,
  pricesInverted,
  setPricesInverted,
  poolType,
  denominationBase,
  formattedMinPrice,
  formattedMaxPrice,
  isFullRange: isFullRangeProp,
  className,
}: MinMaxRangeProps) {
  // Determine min/max prices and full range status
  // Use pre-formatted values if provided, otherwise use hook
  let minPrice: string;
  let maxPrice: string;
  let isFullRange: boolean;

  if (formattedMinPrice !== undefined && formattedMaxPrice !== undefined) {
    // Use pre-formatted values
    minPrice = formattedMinPrice;
    maxPrice = formattedMaxPrice;
    isFullRange = isFullRangeProp ?? false;
  } else if (priceOrdering) {
    // Use hook for SDK Price-based formatting
    const rangeDisplay = getRangeDisplay({
      priceOrdering,
      tickSpacing,
      tickLower,
      tickUpper,
      pricesInverted,
    });
    minPrice = rangeDisplay.minPrice;
    maxPrice = rangeDisplay.maxPrice;
    isFullRange = rangeDisplay.isFullRange ?? false;
  } else {
    // Fallback
    minPrice = '-';
    maxPrice = '-';
    isFullRange = false;
  }

  // Format prices with appropriate decimals
  const decimals = getDecimalsForDenomination(denominationBase || '', poolType);
  const displayMinPrice = formatPriceForDisplay(minPrice, decimals);
  const displayMaxPrice = formatPriceForDisplay(maxPrice, decimals);

  // Full range case - mirrors Uniswap's full range display
  if (isFullRange) {
    return (
      <FeeStat className={cn("hidden lg:flex", className)}>
        <span className="text-xs font-medium font-mono">Full range</span>
        <span className="text-[10px] text-muted-foreground">Range</span>
      </FeeStat>
    );
  }

  // Bounded range - mirrors Uniswap's min/max display
  return (
    <FeeStat className={cn("hidden lg:flex", className)}>
      <span className="text-xs text-foreground truncate font-mono">
        {displayMinPrice} - {displayMaxPrice}
      </span>
      <span className="text-[10px] text-muted-foreground">Range</span>
    </FeeStat>
  );
}
