/**
 * PointsRewardBadge
 *
 * Displays a badge showing points APR bonus on a position.
 * Mirrors Uniswap's LPIncentiveRewardsBadge from:
 * - interface/apps/web/src/components/Liquidity/LPIncentives/LPIncentiveRewardsBadge.tsx
 *
 * @example
 * ```tsx
 * <PointsRewardBadge formattedPointsApr="+12.5%" />
 * ```
 */

"use client"

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { POINTS_CAMPAIGN_ICON } from './constants';

interface PointsRewardBadgeProps {
  /** Formatted points APR string (e.g., "+12.5%") */
  formattedPointsApr: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Points reward badge component.
 * Displays points APR with Alphix logo icon.
 *
 * Mirrors Uniswap's LPIncentiveRewardsBadge:
 * - Badge variant: SOFT (soft background)
 * - Layout: text + currency logo
 * - Color: $accent1 (brand accent)
 *
 * Tailwind mapping:
 * - $accent1 → text-primary (brand color)
 * - BadgeVariant.SOFT → bg-primary/10 (soft background)
 * - $rounded6 → rounded-md
 */
export function PointsRewardBadge({
  formattedPointsApr,
  className,
}: PointsRewardBadgeProps) {
  return (
    <div
      className={cn(
        // Badge container - mirrors BadgeVariant.SOFT with $rounded6
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
        "bg-primary/10",
        className
      )}
    >
      {/* Points APR text - mirrors Text variant="buttonLabel4" color="$accent1" */}
      <span className="text-xs font-medium text-primary">
        {formattedPointsApr}
      </span>
      {/* Points icon - mirrors CurrencyLogo size={12} */}
      <Image
        src={POINTS_CAMPAIGN_ICON}
        alt="Points"
        width={12}
        height={12}
        className="rounded-full"
      />
    </div>
  );
}
