/**
 * PointsCampaignDisplay
 *
 * Displays points campaign APR with icon and optional tooltip.
 * Mirrors Uniswap's LpIncentivesAprDisplay from:
 * - interface/apps/web/src/components/LpIncentives/LpIncentivesAprDisplay.tsx
 *
 * IMPORTANT: Backend logic is IDENTICAL to Uniswap's implementation.
 *
 * @example
 * ```tsx
 * <PointsCampaignDisplay
 *   pointsApr={12.5}
 *   isSmall={false}
 *   showLabel={true}
 *   tooltipProps={{
 *     token0Symbol: "USDC",
 *     token1Symbol: "WETH",
 *     poolApr: 5.2,
 *     totalApr: 17.7,
 *   }}
 * />
 * ```
 */

"use client"

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { POINTS_CAMPAIGN_ICON, POINTS_UNIT } from './constants';
import { PointsTooltip, TooltipSize } from './PointsTooltip';
import { PointsFeeStatTooltip } from './PointsFeeStatTooltip';
import { formatPercent } from './formatters';

// =============================================================================
// TYPES
// Mirrors LpIncentiveAprTooltipProps from Uniswap
// =============================================================================

/**
 * Props for points tooltip display.
 * Mirrors Uniswap's LpIncentiveAprTooltipProps.
 */
interface PointsCampaignTooltipProps {
  /** Token0 symbol */
  token0Symbol?: string;
  /** Token1 symbol */
  token1Symbol?: string;
  /** Pool APR (trading fees) */
  poolApr?: number;
  /** Total APR (pool + points) */
  totalApr?: number;
}

interface PointsCampaignDisplayProps {
  /** Points APR value (numeric, e.g., 12.5 for 12.5%) */
  pointsApr: number;
  /** Render smaller variant (mirrors isSmall) */
  isSmall?: boolean;
  /** Hide background color (mirrors hideBackground) */
  hideBackground?: boolean;
  /** Show points unit label (mirrors showTokenSymbol) */
  showLabel?: boolean;
  /** Optional tooltip data - when provided, wraps content in tooltip */
  tooltipProps?: PointsCampaignTooltipProps;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Points campaign display component.
 * Shows points APR with Alphix logo and optional styling variants.
 *
 * Mirrors Uniswap's LpIncentivesAprDisplay:
 * - Background: $accent2 (conditional) → bg-primary/5
 * - Padding: $spacing6 (conditional) → px-2
 * - Border radius: $rounded6 → rounded-md
 * - Gap: $spacing6 → gap-1.5
 * - Text color: $accent1 → text-primary
 * - Text variant: body3/body4 → text-sm/text-xs
 *
 * Backend logic is IDENTICAL to Uniswap:
 * - formatPercent uses Intl.NumberFormat with percent style
 * - Tooltip wrapper uses MouseoverTooltip pattern
 */
export function PointsCampaignDisplay({
  pointsApr,
  isSmall = false,
  hideBackground = false,
  showLabel = false,
  tooltipProps,
  className,
}: PointsCampaignDisplayProps) {
  // Format using identical logic to Uniswap's formatPercent
  const formattedApr = formatPercent(pointsApr);

  const content = (
    <div
      className={cn(
        // Layout - mirrors Flex row gap="$spacing6" alignItems="center"
        "inline-flex items-center gap-1.5",
        // Conditional background - mirrors backgroundColor={hideBackground ? undefined : '$accent2'}
        !hideBackground && "bg-primary/5 px-2 rounded-md",
        // Add clickable style when tooltip is present - mirrors ClickableTamaguiStyle
        tooltipProps && "cursor-pointer",
        className
      )}
    >
      {/* Points icon - mirrors CurrencyLogo size={isSmall ? 12 : 16} */}
      <Image
        src={POINTS_CAMPAIGN_ICON}
        alt="Points"
        width={isSmall ? 12 : 16}
        height={isSmall ? 12 : 16}
        className="rounded-full"
      />
      {/* APR text - mirrors Text variant={isSmall ? 'body4' : 'body3'} color="$accent1" */}
      <span className={cn(
        "font-medium text-primary",
        isSmall ? "text-xs" : "text-sm"
      )}>
        {showLabel
          ? `${formattedApr} ${POINTS_UNIT}`
          : formattedApr
        }
      </span>
    </div>
  );

  // Wrap with tooltip when tooltipProps provided
  // Mirrors Uniswap's MouseoverTooltip with LPIncentiveFeeStatTooltip
  if (tooltipProps) {
    return (
      <PointsTooltip
        content={
          <PointsFeeStatTooltip
            token0Symbol={tooltipProps.token0Symbol}
            token1Symbol={tooltipProps.token1Symbol}
            poolApr={tooltipProps.poolApr}
            pointsApr={pointsApr}
            totalApr={tooltipProps.totalApr}
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

  return content;
}
