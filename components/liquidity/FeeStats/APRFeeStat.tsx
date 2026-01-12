/**
 * APRFeeStat
 *
 * Displays APR stat with unified breakdown tooltip.
 * Shows Swap APR, Unified Yield, and Points on hover.
 *
 * @example
 * ```tsx
 * <APRFeeStat
 *   formattedApr="12.50%"
 *   swapApr={10}
 *   unifiedYieldApr={2}
 *   pointsApr={0.5}
 *   token0Symbol="USDC"
 *   token1Symbol="WETH"
 * />
 * ```
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { FeeStat, FeeStatLoader } from './FeeStat';
import { PointsTooltip, TooltipSize } from '../PointsCampaign/PointsTooltip';
import { APRBreakdownTooltip } from '../APRBreakdownTooltip';
import type { APRFeeStatProps } from './types';

/**
 * APR fee stat component.
 * Displays formatted APR with unified breakdown tooltip on hover.
 *
 * Design:
 * - Shows APR value with dotted underline indicating hover for more info
 * - Hover shows unified breakdown: Swap APR + Unified Yield + Points
 */
export function APRFeeStat({
  formattedApr,
  isFallback = false,
  isLoading = false,
  swapApr,
  unifiedYieldApr,
  pointsApr,
  token0Symbol,
  token1Symbol,
}: APRFeeStatProps) {
  // Show loader when loading
  if (isLoading) {
    return <FeeStatLoader />;
  }

  const content = (
    <FeeStat>
      {/* APR value with dotted underline to indicate hover for more info */}
      <span className={cn(
        "text-sm font-medium font-mono underline decoration-dotted decoration-muted-foreground/50 underline-offset-2",
        isFallback && "text-white/50"
      )}>
        {formattedApr}
      </span>
      {/* Label */}
      <span className="text-xs text-muted-foreground">
        APR
      </span>
    </FeeStat>
  );

  // Wrap with unified tooltip for breakdown
  return (
    <PointsTooltip
      content={
        <APRBreakdownTooltip
          swapApr={swapApr}
          unifiedYieldApr={unifiedYieldApr}
          pointsApr={pointsApr}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
        />
      }
      size={TooltipSize.Small}
      padding={0}
      placement="top"
    >
      {content}
    </PointsTooltip>
  );
}
