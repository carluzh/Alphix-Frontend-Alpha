/**
 * FeeStat
 *
 * Wrapper component for individual fee stat columns.
 * Mirrors Uniswap's FeeStat from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 61-67)
 *
 * Provides consistent flex layout for all stats in LiquidityPositionFeeStats.
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import type { FeeStatProps } from './types';

// =============================================================================
// FESTAT WRAPPER
// Mirrors Uniswap's FeeStat: Flex flex={1} flexBasis={0} $sm={{ flexBasis: 'auto' }}
// =============================================================================

/**
 * FeeStat wrapper component.
 * Provides consistent flex layout for stat columns.
 *
 * Tailwind mapping:
 * - flex={1} → flex-1
 * - flexBasis={0} → (implicit in flex-1)
 * - $sm={{ flexBasis: 'auto' }} → sm:flex-auto (handled by responsive)
 *
 * @example
 * ```tsx
 * <FeeStat>
 *   <span className="text-xs font-medium">$1,234.56</span>
 *   <span className="text-[10px] text-muted-foreground">Position</span>
 * </FeeStat>
 * ```
 */
export function FeeStat({ children, className }: FeeStatProps) {
  return (
    <div className={cn(
      // Mirrors: Flex flex={1} flexBasis={0}
      "flex flex-col gap-0.5 flex-1 min-w-0",
      className
    )}>
      {children}
    </div>
  );
}

// =============================================================================
// FEESTAT LOADER
// Mirrors Uniswap's FeeStatLoader from lines 69-76
// =============================================================================

/**
 * Skeleton loader for FeeStat.
 * Displays animated placeholder for loading states.
 *
 * Mirrors Uniswap's FeeStatLoader:
 * - TextLoader width 60 for value
 * - TextLoader width 40 for label
 */
export function FeeStatLoader() {
  return (
    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
      {/* Value skeleton - mirrors TextLoader width={60} */}
      <div className="h-4 w-16 bg-muted/60 rounded animate-pulse mb-0.5" />
      {/* Label skeleton - mirrors TextLoader width={40} */}
      <div className="h-3 w-10 bg-muted/40 rounded animate-pulse" />
    </div>
  );
}

// =============================================================================
// LIQUIDITY POSITION FEE STATS LOADER
// Mirrors Uniswap's LiquidityPositionFeeStatsLoader from lines 78-86
// =============================================================================

/**
 * Full skeleton loader for LiquidityPositionFeeStats.
 * Displays three FeeStatLoader components in a row.
 *
 * Mirrors Uniswap's LiquidityPositionFeeStatsLoader:
 * - Flex row gap="$gap20" justifyContent="space-between" width="50%"
 * - Three FeeStatLoader children
 */
export function LiquidityPositionFeeStatsLoader() {
  return (
    <div className="flex items-center justify-between gap-5 w-1/2 md:w-full">
      <FeeStatLoader />
      <FeeStatLoader />
      <FeeStatLoader />
    </div>
  );
}
