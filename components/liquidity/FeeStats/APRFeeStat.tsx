/**
 * APRFeeStat
 *
 * Displays APR stat with unified breakdown tooltip.
 * Shows Swap APR, Lending Yield, and Points on hover.
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

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { FeeStat, FeeStatLoader } from './FeeStat';
import { PointsTooltip, TooltipSize } from '../PointsCampaign/PointsTooltip';
import { APRBreakdownTooltip } from '../APRBreakdownTooltip';
import type { APRFeeStatProps } from './types';

/**
 * Format APR value for display
 */
function formatAprDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (value === 0) return '0.00%';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K%`;
  if (value >= 100) return `${value.toFixed(0)}%`;
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

/**
 * APR fee stat component.
 * Displays total APR (Swap + Lending Yield) with unified breakdown tooltip on hover.
 *
 * Design:
 * - Shows total APR (Swap + Lending) with dotted underline indicating hover for more info
 * - Hover shows unified breakdown: Swap APR + Lending Yield + Points
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

  // Calculate total APR for display (Swap + Lending Yield)
  // Points are shown in tooltip but not included in main display
  const displayApr = useMemo(() => {
    const swap = swapApr ?? 0;
    const unified = unifiedYieldApr ?? 0;
    const total = swap + unified;

    // If we have no data at all, use the pre-formatted value as fallback
    if (swap === 0 && unified === 0 && formattedApr && formattedApr !== '-') {
      return formattedApr;
    }

    return formatAprDisplay(total);
  }, [swapApr, unifiedYieldApr, formattedApr]);

  const content = (
    <FeeStat>
      {/* APR value with dotted underline to indicate hover for more info */}
      <span className={cn(
        "text-sm font-medium font-mono underline decoration-dotted decoration-muted-foreground/50 underline-offset-2",
        isFallback && "text-white/50"
      )}>
        {displayApr}
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
