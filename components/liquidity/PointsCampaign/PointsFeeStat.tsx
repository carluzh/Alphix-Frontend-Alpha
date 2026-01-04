/**
 * PointsFeeStat
 *
 * Displays total APR with visual emphasis for positions earning points.
 * Shows breakdown tooltip on hover with Pool APR and Points APR.
 *
 * @example
 * ```tsx
 * <PointsFeeStat
 *   poolApr={5.2}
 *   pointsApr={12.5}
 *   totalApr={17.7}
 *   token0Symbol="USDC"
 *   token1Symbol="WETH"
 * />
 * ```
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { PointsTooltip, TooltipSize } from './PointsTooltip';
import { PointsFeeStatTooltip } from './PointsFeeStatTooltip';
import { formatPercent, PLACEHOLDER_TEXT } from './formatters';

interface PointsFeeStatProps {
  /** Pool APR from trading fees */
  poolApr?: number;
  /** Points campaign APR bonus */
  pointsApr: number;
  /** Total APR (pool + points) */
  totalApr?: number;
  /** Token0 symbol (for tooltip) */
  token0Symbol?: string;
  /** Token1 symbol (for tooltip) */
  token1Symbol?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Points fee stat component.
 * Displays total APR with visual emphasis and hover tooltip for breakdown.
 *
 * Design:
 * - Shows total APR value in primary color with subtle background
 * - Green color indicates boosted APR from points campaign
 * - Hover shows breakdown: Pool APR + Points APR
 */
export function PointsFeeStat({
  poolApr,
  pointsApr,
  totalApr,
  token0Symbol,
  token1Symbol,
  className,
}: PointsFeeStatProps) {
  // Format total APR for display
  const formattedTotalApr = totalApr !== undefined ? formatPercent(totalApr) : PLACEHOLDER_TEXT;

  // Content to display (wrapped in tooltip)
  const content = (
    <div className={cn("flex flex-col gap-0.5 flex-1 min-w-0", className)}>
      {/* APR value with dotted underline to indicate hover for more info */}
      <span className="text-sm font-medium font-mono underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
        {formattedTotalApr}
      </span>
      {/* Label */}
      <span className="text-xs text-muted-foreground">
        APR
      </span>
    </div>
  );

  // Wrap with tooltip for breakdown
  return (
    <PointsTooltip
      content={
        <PointsFeeStatTooltip
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          poolApr={poolApr}
          pointsApr={pointsApr}
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
