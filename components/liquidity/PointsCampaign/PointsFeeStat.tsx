/**
 * PointsFeeStat
 *
 * Displays total APR with points icon for positions earning points.
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
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { PointsTooltip, TooltipSize } from './PointsTooltip';
import { PointsFeeStatTooltip } from './PointsFeeStatTooltip';
import { formatPercent, PLACEHOLDER_TEXT } from './formatters';
import { POINTS_CAMPAIGN_ICON } from './constants';

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
 * Displays total APR with points icon and hover tooltip for breakdown.
 *
 * Design:
 * - Shows total APR value with Alphix icon on the right
 * - Icon indicates this APR includes points bonus
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
      {/* APR row with icon */}
      <div className="flex items-center gap-1.5">
        {/* Total APR value */}
        <span className="text-xs font-medium font-mono text-primary">
          {formattedTotalApr}
        </span>
        {/* Points icon indicating bonus APR */}
        <Image
          src={POINTS_CAMPAIGN_ICON}
          alt="Points bonus"
          width={12}
          height={12}
          className="rounded-full"
        />
      </div>
      {/* Label */}
      <span className="text-[10px] text-muted-foreground">
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
