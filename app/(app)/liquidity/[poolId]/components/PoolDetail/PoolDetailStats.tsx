"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { PoolStats } from "../../hooks";

interface PoolDetailStatsProps {
  poolStats: PoolStats;
  loading?: boolean;
  onStatClick?: (stat: "tvl" | "volume") => void;
}

/**
 * Pool stats display — 3 simple cards.
 * APY now comes fully computed from the backend via poolStats.aprRaw (= totalApy).
 */
export const PoolDetailStats = memo(function PoolDetailStats({
  poolStats,
  loading,
  onStatClick,
}: PoolDetailStatsProps) {
  const isLoading = loading || poolStats.tvlFormatted === "Loading...";

  const { totalApy, totalApyFormatted } = useMemo(() => {
    const total = poolStats.aprRaw || 0;
    return {
      totalApy: total,
      totalApyFormatted: total > 0 ? `${total.toFixed(2)}%` : "0.00%",
    };
  }, [poolStats.aprRaw]);

  const hasPositiveApy = totalApy > 0;
  const cardBase = "flex-1 min-w-0 rounded-lg bg-muted/30 px-3 py-2";

  return (
    <div className="flex flex-wrap gap-3">
      <button
        className={cn(cardBase, "text-left transition-colors hover:bg-muted/50 cursor-pointer")}
        onClick={() => onStatClick?.("tvl")}
      >
        <h3 className="text-[11px] text-muted-foreground font-medium mb-0.5">
          Total Deposits
        </h3>
        {isLoading ? (
          <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div className="text-sm font-semibold">{poolStats.tvlFormatted}</div>
        )}
      </button>

      <button
        className={cn(cardBase, "text-left transition-colors hover:bg-muted/50 cursor-pointer")}
        onClick={() => onStatClick?.("volume")}
      >
        <h3 className="text-[11px] text-muted-foreground font-medium mb-0.5">
          Volume (24h)
        </h3>
        {isLoading ? (
          <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div className="text-sm font-semibold">{poolStats.volume24hFormatted}</div>
        )}
      </button>

      <div
        className={cn(
          hasPositiveApy
            ? "flex-1 min-w-0 rounded-lg input-gradient-hover input-gradient-always-visible overflow-visible"
            : cardBase
        )}
      >
        <div className={cn(
          "rounded-lg px-3 py-2 h-full",
          hasPositiveApy ? "relative z-[1] bg-container" : ""
        )}>
          <h3 className="text-[11px] text-muted-foreground font-medium mb-0.5">
            APY
          </h3>
          {isLoading ? (
            <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
          ) : (
            <div className="text-sm font-semibold text-foreground">
              {hasPositiveApy ? totalApyFormatted : poolStats.apr}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
