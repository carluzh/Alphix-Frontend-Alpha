/**
 * PointsFeeStat
 *
 * Displays pool APR with points bonus badge in position fee stats.
 * Mirrors Uniswap's LPIncentiveFeeStat from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 281-327)
 *
 * IMPORTANT: Backend logic is IDENTICAL to Uniswap's implementation.
 *
 * This component is used within LiquidityPositionFeeStats to show
 * combined pool APR + points APR when a position is earning points.
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
import { PointsRewardBadge } from './PointsRewardBadge';
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
 * Displays pool APR with points bonus badge and hover tooltip.
 *
 * Mirrors Uniswap's LPIncentiveFeeStat:
 * - Layout: Flex row gap="$spacing6" alignItems="center"
 * - Pool APR: Text variant="body2" color="$neutral1"
 * - Points badge: LPIncentiveRewardsBadge
 * - Label: Text variant="body3" color="$neutral2"
 * - Tooltip: MouseoverTooltip with LPIncentiveFeeStatTooltip
 *
 * Backend logic is IDENTICAL to Uniswap:
 * - formatPercent divides by 100 for Intl.NumberFormat percent style
 * - Tooltip shows Pool APR, Points APR, Total APR breakdown
 */
export function PointsFeeStat({
  poolApr,
  pointsApr,
  totalApr,
  token0Symbol,
  token1Symbol,
  className,
}: PointsFeeStatProps) {
  // Format using identical logic to Uniswap's formatPercent
  const formattedPoolApr = poolApr !== undefined ? formatPercent(poolApr) : PLACEHOLDER_TEXT;
  const formattedPointsApr = `+${formatPercent(pointsApr)}`;

  // Content to display (wrapped in tooltip)
  // Mirrors Uniswap's LPIncentiveFeeStat structure
  const content = (
    <div className={className}>
      {/* APR row - mirrors Flex row gap="$spacing6" alignItems="center" */}
      <div className="flex items-center gap-1.5">
        {/* Pool APR - mirrors Text variant="body2" color="$neutral1" */}
        <span className="text-sm text-foreground">
          {formattedPoolApr}
        </span>
        {/* Points badge - mirrors LPIncentiveRewardsBadge */}
        <PointsRewardBadge formattedPointsApr={formattedPointsApr} />
      </div>
      {/* Label - mirrors SecondaryText variant="body3" color="$neutral2" */}
      <span className="text-xs text-muted-foreground">
        Total APR
      </span>
    </div>
  );

  // Wrap with tooltip - mirrors MouseoverTooltip with LPIncentiveFeeStatTooltip
  // Uniswap uses: padding={0}, size={TooltipSize.Small}, placement="top"
  return (
    <PointsTooltip
      content={
        <PointsFeeStatTooltip
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          poolApr={poolApr}
          pointsApr={pointsApr}
          totalApr={totalApr}
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
