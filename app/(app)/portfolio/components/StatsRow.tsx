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

  return (
    <div
      className={cn(
        "rounded-lg border border-sidebar-border bg-container overflow-hidden",
        className
      )}
    >
      <div className="flex flex-row">
        {/* Swaps This Week */}
        <div className="flex-1 p-4 border-r border-sidebar-border">
          <div className="text-xs text-muted-foreground mb-1">
            Swaps This Week
          </div>
          <div className={cn(
            "text-xl font-medium text-foreground",
            isLoading && "animate-pulse"
          )}>
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-6 w-12" />
            ) : stats.swapsThisWeek > 0 ? (
              stats.swapsThisWeek
            ) : (
              "—"
            )}
          </div>
        </div>

        {/* Volume This Week */}
        <div className="flex-1 p-4">
          <div className="text-xs text-muted-foreground mb-1">
            Swapped This Week
          </div>
          <div className={cn(
            "text-xl font-medium text-foreground",
            isLoading && "animate-pulse"
          )}>
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-6 w-20" />
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
