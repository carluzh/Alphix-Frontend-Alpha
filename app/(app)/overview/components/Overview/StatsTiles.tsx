"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface OverviewStatsTilesProps {
  dailyPoints?: number;
  leaderboardPosition?: number | null;
  isLoading?: boolean;
}

/**
 * OverviewStatsTiles - Points stats display
 */
export const OverviewStatsTiles = memo(function OverviewStatsTiles({
  dailyPoints,
  leaderboardPosition,
  isLoading = false,
}: OverviewStatsTilesProps) {
  const DASH = "-";

  const formatPoints = (value: number) => {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  return (
    <div
      className={cn(
        "border border-sidebar-border rounded-xl",
        "overflow-hidden",
        "w-full"
      )}
    >
      <div className="flex flex-row">
        {/* Left Cell: 24h Points */}
        <div className="border-r border-sidebar-border px-3 py-2.5 w-1/2">
          <div className="text-xs text-muted-foreground">24h Points</div>
          <div className="text-base font-medium text-foreground mt-0.5">
            {isLoading ? (
              <span className="inline-block bg-muted/60 animate-pulse rounded h-5 w-16" />
            ) : dailyPoints !== undefined && dailyPoints > 0 ? (
              formatPoints(dailyPoints)
            ) : (
              DASH
            )}
          </div>
        </div>

        {/* Right Cell: Leaderboard Position */}
        <div className="px-3 py-2.5 w-1/2">
          <div className="text-xs text-muted-foreground">Leaderboard</div>
          <div className="text-base font-medium text-foreground mt-0.5">
            {isLoading ? (
              <span className="inline-block bg-muted/60 animate-pulse rounded h-5 w-12" />
            ) : leaderboardPosition !== null && leaderboardPosition !== undefined && leaderboardPosition > 0 ? (
              <span>#{leaderboardPosition.toLocaleString("en-US")}</span>
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
