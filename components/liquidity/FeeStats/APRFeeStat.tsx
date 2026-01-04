/**
 * APRFeeStat
 *
 * Displays APR stat for positions without points campaign.
 * Mirrors Uniswap's APRFeeStat from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 267-279)
 *
 * For positions with points campaign active, use PointsFeeStat instead.
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { FeeStat, FeeStatLoader } from './FeeStat';
import type { APRFeeStatProps } from './types';

/**
 * APR fee stat component.
 * Displays formatted APR with optional fallback styling.
 *
 * Mirrors Uniswap's APRFeeStat:
 * - PrimaryText: apr ? formatPercent(apr) : '-'
 * - SecondaryText: t('pool.apr')
 *
 * Tailwind mapping:
 * - Text variant="body2" color="$neutral1" → text-xs font-medium text-foreground
 * - Text variant="body3" color="$neutral2" → text-[10px] text-muted-foreground
 *
 * @example
 * ```tsx
 * <APRFeeStat formattedApr="12.50%" />
 * <APRFeeStat formattedApr="5.00%" isFallback />
 * <APRFeeStat formattedApr="-" isLoading />
 * ```
 */
export function APRFeeStat({
  formattedApr,
  isFallback = false,
  isLoading = false,
}: APRFeeStatProps) {
  // Show loader when loading
  if (isLoading) {
    return <FeeStatLoader />;
  }

  return (
    <FeeStat>
      {/* APR value - mirrors PrimaryText */}
      <span className={cn(
        "text-sm font-medium font-mono",
        isFallback && "text-white/50"
      )}>
        {formattedApr}
      </span>
      {/* Label - mirrors SecondaryText */}
      <span className="text-xs text-muted-foreground">
        APR
      </span>
    </FeeStat>
  );
}
