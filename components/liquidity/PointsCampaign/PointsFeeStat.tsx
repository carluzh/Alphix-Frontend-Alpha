/**
 * PointsFeeStat
 *
 * Displays total APR with visual emphasis for positions earning points.
 * Shows unified breakdown tooltip on hover with Swap APR, Lending Yield, and Points.
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
import { APRBreakdownTooltip } from '../APRBreakdownTooltip';
import { formatPercent, PLACEHOLDER_TEXT } from './formatters';

interface PointsFeeStatProps {
  /** Pool APR from trading fees (Swap APR) */
  poolApr?: number;
  /** Points campaign APR bonus */
  pointsApr: number;
  /** Total APR (pool + points + unified yield) */
  totalApr?: number;
  /** Lending Yield APR (Aave lending) - optional */
  unifiedYieldApr?: number;
  /** Token0 symbol (for tooltip) */
  token0Symbol?: string;
  /** Token1 symbol (for tooltip) */
  token1Symbol?: string;
  /** Yield sources for multi-source lending display */
  yieldSources?: Array<'aave' | 'spark'>;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Points fee stat component.
 * Displays total APR with visual emphasis and hover tooltip for breakdown.
 *
 * Design:
 * - Shows total APR value with dotted underline indicating hover for more info
 * - Hover shows unified breakdown: Swap APR + Lending Yield + Points
 */
export function PointsFeeStat({
  poolApr,
  pointsApr,
  totalApr,
  unifiedYieldApr,
  token0Symbol,
  token1Symbol,
  yieldSources,
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

  // Wrap with unified tooltip for breakdown
  return (
    <PointsTooltip
      content={
        <APRBreakdownTooltip
          swapApr={poolApr}
          unifiedYieldApr={unifiedYieldApr}
          pointsApr={pointsApr}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          yieldSources={yieldSources}
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
