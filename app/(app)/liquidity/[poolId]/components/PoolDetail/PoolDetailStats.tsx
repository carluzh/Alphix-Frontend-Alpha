"use client";

import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { fetchAaveRates, getLendingAprForPair } from "@/lib/aave-rates";
import type { NetworkMode } from "@/lib/network-mode";
import type { PoolStats } from "../../hooks";

interface PoolDetailStatsProps {
  poolStats: PoolStats;
  loading?: boolean;
  /** Token symbols for APR tooltip */
  token0Symbol?: string;
  token1Symbol?: string;
  /** Network mode for fetching correct Aave rates */
  networkMode?: NetworkMode;
  /** Called when a stat is clicked to switch the chart below */
  onStatClick?: (stat: "tvl" | "volume") => void;
}

/**
 * Pool stats display — 3 simple cards matching the liquidity page topper style.
 * Total Deposits and Volume are clickable to switch the chart below.
 * APR retains the hover breakdown tooltip.
 */
export const PoolDetailStats = memo(function PoolDetailStats({
  poolStats,
  loading,
  token0Symbol,
  token1Symbol,
  networkMode,
  onStatClick,
}: PoolDetailStatsProps) {
  const isLoading = loading || poolStats.tvlFormatted === "Loading...";

  // Fetch Aave rates for Lending Yield display (network-aware)
  const { data: aaveRatesData } = useQuery({
    queryKey: ['aaveRates', networkMode ?? 'default'],
    queryFn: () => fetchAaveRates(networkMode),
    staleTime: 5 * 60_000,
  });

  // Calculate lending yield APR
  const unifiedYieldApr = useMemo(() => {
    if (!token0Symbol || !token1Symbol) return 0;
    return getLendingAprForPair(aaveRatesData, token0Symbol, token1Symbol) ?? 0;
  }, [aaveRatesData, token0Symbol, token1Symbol]);

  // Calculate APR values
  const { poolApr, totalApr, totalAprFormatted } = useMemo(() => {
    const rawApr = poolStats.aprRaw || 0;
    const total = rawApr + unifiedYieldApr;
    return {
      poolApr: rawApr,
      totalApr: total,
      totalAprFormatted: total > 0 ? `${total.toFixed(2)}%` : "0.00%",
    };
  }, [poolStats.aprRaw, unifiedYieldApr]);

  const hasPositiveApr = totalApr > 0;

  // Shared card style — matches liquidity page topper (bg-muted/30, simple)
  const cardBase = "flex-1 min-w-[130px] rounded-lg bg-muted/30 px-4 py-3";

  return (
    <div className="flex flex-wrap gap-3">
      {/* Total Deposits — clickable → TVL chart */}
      <button
        className={cn(cardBase, "text-left transition-colors hover:bg-muted/50 cursor-pointer")}
        onClick={() => onStatClick?.("tvl")}
      >
        <h3 className="text-xs text-muted-foreground font-medium mb-1">
          Total Deposits
        </h3>
        {isLoading ? (
          <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div className="text-lg font-semibold">{poolStats.tvlFormatted}</div>
        )}
      </button>

      {/* Volume — clickable → Volume chart */}
      <button
        className={cn(cardBase, "text-left transition-colors hover:bg-muted/50 cursor-pointer")}
        onClick={() => onStatClick?.("volume")}
      >
        <h3 className="text-xs text-muted-foreground font-medium mb-1">
          Volume (24h)
        </h3>
        {isLoading ? (
          <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
        ) : (
          <div className="text-lg font-semibold">{poolStats.volume24hFormatted}</div>
        )}
      </button>

      {/* APR — gradient border, no hover breakdown (breakdown is in sidebar) */}
      <div
        className={cn(
          hasPositiveApr
            ? "flex-1 min-w-[130px] rounded-lg input-gradient-hover input-gradient-always-visible overflow-visible"
            : cardBase
        )}
      >
        <div className={cn(
          "rounded-lg px-4 py-3 h-full",
          hasPositiveApr
            ? "relative z-[1] bg-container"
            : ""
        )}>
          <h3 className="text-xs text-muted-foreground font-medium mb-1">
            APR
          </h3>
          {isLoading ? (
            <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
          ) : (
            <div className="text-lg font-semibold text-foreground">
              {hasPositiveApr ? totalAprFormatted : poolStats.apr}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
