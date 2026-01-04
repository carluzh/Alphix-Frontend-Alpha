"use client";

import { memo } from "react";

interface PointsCounterProps {
  isCompact?: boolean;
  totalPoints?: number;
  dailyPoints?: number;
}

/**
 * PointsCounter - Points display matching stat card styling
 * Height matches profile image (48px)
 */
export const PointsCounter = memo(function PointsCounter({
  isCompact = false,
  totalPoints = 1847.2391,
  dailyPoints = 23.4872,
}: PointsCounterProps) {
  // Format number with commas and 4 decimals
  const formatPoints = (value: number) => {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  };

  if (isCompact) {
    return null;
  }

  return (
    <div
      className="flex flex-col justify-center rounded-lg bg-muted/30 border border-sidebar-border/60 px-4"
      style={{ height: 48 }}
    >
      {/* Points Row */}
      <div className="flex items-center justify-between gap-6">
        <span className="text-xs text-muted-foreground">Points</span>
        <span
          className="text-sm font-medium text-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatPoints(totalPoints)}
        </span>
      </div>

      {/* 24H Row */}
      <div className="flex items-center justify-between gap-6">
        <span className="text-xs text-muted-foreground">24H</span>
        <span
          className="text-sm text-muted-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatPoints(dailyPoints)}
        </span>
      </div>
    </div>
  );
});

export default PointsCounter;
