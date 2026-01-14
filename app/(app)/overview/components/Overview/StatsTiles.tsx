"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface OverviewStatsTilesProps {
  dailyPoints?: number;
  leaderboardPosition?: number | null;
  isLoading?: boolean;
}

/**
 * Format points with 4 decimal places
 */
function formatPoints(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/**
 * Format leaderboard position with ordinal suffix
 */
function formatPosition(position: number | null): string {
  if (position === null || position <= 0) return "-";
  return `#${position.toLocaleString("en-US")}`;
}

/**
 * OverviewStatsTiles - Points stats display
 *
 * Layout:
 * - borderWidth={1} borderColor="$surface3" → border border-sidebar-border
 * - borderRadius="$rounded16" → rounded-2xl
 * - Two 50% width cells with border between
 * - Compact padding for reduced height
 *
 * Content:
 * - Left: "24h Points" + daily points earned
 * - Right: "Leaderboard" + position in points campaign
 */
export const OverviewStatsTiles = memo(function OverviewStatsTiles({
  dailyPoints,
  leaderboardPosition,
  isLoading = false,
}: OverviewStatsTilesProps) {
  const DASH = "-";

  return (
    <div
      className={cn(
        // Border and radius
        "border border-sidebar-border rounded-xl",
        // Overflow
        "overflow-hidden",
        // Full width
        "w-full"
      )}
    >
      <div className="flex flex-row">
        {/* Left Cell: 24h Points */}
        <div className="border-r border-sidebar-border px-3 py-2.5 w-1/2">
          {/* Label */}
          <div className="text-xs text-muted-foreground">24h Points</div>
          {/* Value */}
          <div
            className={cn(
              "text-base font-medium text-foreground mt-0.5",
              isLoading && "animate-pulse"
            )}
          >
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-5 w-16" />
            ) : dailyPoints !== undefined && dailyPoints > 0 ? (
              formatPoints(dailyPoints)
            ) : (
              DASH
            )}
          </div>
        </div>

        {/* Right Cell: Leaderboard Position */}
        <div className="px-3 py-2.5 w-1/2">
          {/* Label */}
          <div className="text-xs text-muted-foreground">Leaderboard</div>
          {/* Value */}
          <div
            className={cn(
              "text-base font-medium text-foreground mt-0.5",
              isLoading && "animate-pulse"
            )}
          >
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-5 w-12" />
            ) : leaderboardPosition !== null && leaderboardPosition !== undefined ? (
              formatPosition(leaderboardPosition)
            ) : (
              DASH
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default OverviewStatsTiles;
