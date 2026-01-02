"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import { useRecentActivity, type ActivityStats } from "../hooks/useRecentActivity";

interface StatsRowProps {
  className?: string;
  /** Override stats (for when activity hook is managed externally) */
  stats?: ActivityStats;
  isLoading?: boolean;
}

/**
 * Stats tiles row component
 * Adapted from Uniswap's OverviewStatsTiles.tsx
 *
 * Displays:
 * - Swaps this week (count)
 * - Swapped this week (volume in USD)
 *
 * SHORTCUT NOTE:
 * This relies on the useRecentActivity hook which requires the
 * /api/portfolio/activity endpoint to be implemented.
 *
 * Until then, it will show "—" for stats.
 */
export function StatsRow({ className, stats: externalStats, isLoading: externalLoading }: StatsRowProps) {
  // Use hook if no external stats provided
  const { stats: hookStats, isLoading: hookLoading } = useRecentActivity();

  const stats = externalStats || hookStats;
  const isLoading = externalLoading !== undefined ? externalLoading : hookLoading;

  // Uniswap StatsTiles styling:
  // - Border: 1px $surface3 (border-sidebar-border)
  // - Border radius: $rounded16 (16px = rounded-2xl)
  // - Padding: $spacing16 (16px = p-4)
  // - Layout: 2 columns with vertical divider (50% width each)
  return (
    <div
      className={cn(
        // Uniswap: borderWidth={1} borderColor="$surface3" borderRadius="$rounded16"
        "rounded-2xl border border-sidebar-border overflow-hidden",
        className
      )}
    >
      <div className="flex flex-row w-full">
        {/* Swaps This Week - Left column (50% width) */}
        <div
          className="p-4 border-r border-sidebar-border"
          style={{ width: "50%" }}
        >
          {/* Label: variant="body3" color="$neutral2" */}
          <div className="text-xs text-muted-foreground">
            Swaps This Week
          </div>
          {/* Value: variant="heading3" color="$neutral1" */}
          <div className={cn(
            "text-lg font-medium text-foreground mt-1",
            isLoading && "animate-pulse"
          )}>
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-5 w-10" />
            ) : stats.swapsThisWeek > 0 ? (
              stats.swapsThisWeek
            ) : (
              "—"
            )}
          </div>
        </div>

        {/* Volume This Week - Right column (50% width) */}
        <div
          className="p-4"
          style={{ width: "50%" }}
        >
          {/* Label: variant="body3" color="$neutral2" */}
          <div className="text-xs text-muted-foreground">
            Swapped This Week
          </div>
          {/* Value: variant="heading3" color="$neutral1" with faded decimals */}
          <div className={cn(
            "text-lg font-medium text-foreground mt-1",
            isLoading && "animate-pulse"
          )}>
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-5 w-16" />
            ) : stats.volumeThisWeekUsd > 0 ? (
              <ValueWithFadedDecimals value={formatUSD(stats.volumeThisWeekUsd)} />
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Value display with faded decimals
 * Following Uniswap's ValueWithFadedDecimals pattern
 */
function ValueWithFadedDecimals({ value }: { value: string }) {
  // Split on decimal point
  const parts = value.split(".");
  if (parts.length === 1) {
    return <span>{value}</span>;
  }

  return (
    <span>
      {parts[0]}
      <span className="text-muted-foreground">.{parts[1]}</span>
    </span>
  );
}

export default StatsRow;
