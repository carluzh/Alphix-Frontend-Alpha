"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface OverviewStatsTilesProps {
  swapCount?: number;
  totalVolumeUSD?: number;
  isLoading?: boolean;
}

/**
 * ValueWithFadedDecimals - matches Uniswap's implementation
 * Splits currency amounts: whole number + faded decimals
 */
function ValueWithFadedDecimals({ value }: { value: string }) {
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

/**
 * Format USD value
 */
function formatUSD(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * OverviewStatsTiles - matches Uniswap's StatsTiles.tsx exactly
 *
 * Layout:
 * - borderWidth={1} borderColor="$surface3" → border border-sidebar-border
 * - borderRadius="$rounded16" → rounded-2xl
 * - Two 50% width cells with border between
 * - padding="$spacing16" → p-4
 *
 * Content:
 * - Left: "Swaps This Week" + count
 * - Right: "Swapped This Week" + volume
 */
export const OverviewStatsTiles = memo(function OverviewStatsTiles({
  swapCount = 0,
  totalVolumeUSD = 0,
  isLoading = false,
}: OverviewStatsTilesProps) {
  const hasVolumeData = totalVolumeUSD > 0;
  const EM_DASH = "—";

  return (
    <div
      className={cn(
        // Border and radius
        "border border-sidebar-border rounded-2xl",
        // Overflow
        "overflow-hidden",
        // Full width
        "w-full"
      )}
    >
      <div className="flex flex-row">
        {/* Left Cell: Swaps This Week */}
        <div className="border-r border-sidebar-border p-4 w-1/2">
          {/* Label: variant="body3" color="$neutral2" */}
          <div className="text-sm text-muted-foreground">Swaps This Week</div>
          {/* Value: variant="heading3" color="$neutral1" */}
          <div
            className={cn(
              "text-2xl font-normal text-foreground mt-1",
              isLoading && "animate-pulse"
            )}
          >
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-7 w-12" />
            ) : (
              swapCount
            )}
          </div>
        </div>

        {/* Right Cell: Swapped This Week */}
        <div className="p-4 w-1/2">
          {/* Label: variant="body3" color="$neutral2" */}
          <div className="text-sm text-muted-foreground">Swapped This Week</div>
          {/* Value: variant="heading3" color="$neutral1" with faded decimals */}
          <div
            className={cn(
              "text-2xl font-normal text-foreground mt-1",
              isLoading && "animate-pulse"
            )}
          >
            {isLoading ? (
              <span className="inline-block bg-muted/60 rounded h-7 w-20" />
            ) : hasVolumeData ? (
              <ValueWithFadedDecimals value={formatUSD(totalVolumeUSD)} />
            ) : (
              EM_DASH
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default OverviewStatsTiles;
