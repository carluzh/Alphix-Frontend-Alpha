"use client";

import { memo, ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { StatSectionBubble } from "../shared/DetailBubble";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { APRBreakdownTooltip } from "@/components/liquidity/APRBreakdownTooltip";
import { fetchAaveRates, getLendingAprForPair } from "@/lib/aave-rates";
import type { PoolStats } from "../../hooks";


interface PoolDetailStatsProps {
  poolStats: PoolStats;
  loading?: boolean;
  /** Token symbols for APR tooltip */
  token0Symbol?: string;
  token1Symbol?: string;
}

interface StatItemProps {
  title: ReactNode;
  value: string;
  loading?: boolean;
  highlight?: boolean;
  className?: string;
}

/**
 * Individual stat item component.
 * Adapted from Uniswap's StatItem pattern.
 */
const StatItem = memo(function StatItem({
  title,
  value,
  loading,
  highlight,
  className,
}: StatItemProps) {
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-[140px]", className)}>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        {title}
      </span>
      {loading ? (
        <StatSectionBubble />
      ) : (
        <span
          className={cn(
            "text-lg font-semibold font-mono",
            highlight ? "text-green-500" : "text-foreground"
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
});

/**
 * Pool stats display component showing TVL, Volume, Fees, and APR.
 * Order: TVL, Volume, Fees, APR (per user request)
 * APR has hover gradient border animation like TokenAmountInput.
 * @see interface/apps/web/src/components/Pools/PoolDetails/PoolDetailsStats.tsx
 */
export const PoolDetailStats = memo(function PoolDetailStats({
  poolStats,
  loading,
  token0Symbol,
  token1Symbol,
}: PoolDetailStatsProps) {
  const isLoading = loading || poolStats.tvlFormatted === "Loading...";
  const hasPositiveApr = poolStats.apr !== "0.00%" && poolStats.aprRaw > 0;
  const hasUnifiedYield = true; // All Alphix pools have unified yield

  // Fetch Aave rates for Lending Yield display
  const { data: aaveRatesData } = useQuery({
    queryKey: ['aaveRates'],
    queryFn: fetchAaveRates,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Calculate lending yield APR (with pool-level factor applied)
  const unifiedYieldApr = useMemo(() => {
    if (!token0Symbol || !token1Symbol) return 0;
    return getLendingAprForPair(aaveRatesData, token0Symbol, token1Symbol) ?? 0;
  }, [aaveRatesData, token0Symbol, token1Symbol]);

  // Calculate APR values (no points bonus - unified yield only)
  const { poolApr, totalApr, totalAprFormatted } = useMemo(() => {
    const rawApr = poolStats.aprRaw || 0;
    const total = rawApr + unifiedYieldApr;

    return {
      poolApr: rawApr,
      totalApr: total,
      totalAprFormatted: total > 0 ? `${total.toFixed(2)}%` : "0.00%",
    };
  }, [poolStats.aprRaw, unifiedYieldApr]);

  // Stat card class (solid border, not dashed - the outer wrapper has the dashed border)
  const statCardClass = "flex-1 min-w-[130px] rounded-lg bg-muted/30 border border-sidebar-border/60 px-4 py-3";

  return (
    <>
      {/* Outer wrapper with dashed border - matches liquidity page.tsx stats container */}
      <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4">
        <div className="flex flex-wrap gap-3">
          {/* TVL */}
          <div className={statCardClass}>
            <h3 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">
              TVL
            </h3>
            {isLoading ? (
              <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
            ) : (
              <div className="text-lg font-semibold font-mono">
                {poolStats.tvlFormatted}
              </div>
            )}
          </div>

          {/* Volume 24h */}
          <div className={statCardClass}>
            <h3 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">
              VOLUME (24H)
            </h3>
            {isLoading ? (
              <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
            ) : (
              <div className="text-lg font-semibold font-mono">
                {poolStats.volume24hFormatted}
              </div>
            )}
          </div>

          {/* APR - with always-visible gradient border animation and tooltip */}
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex-1 min-w-[130px]",
                    hasPositiveApr && hasUnifiedYield && "input-gradient-hover input-gradient-always-visible overflow-visible m-px cursor-pointer"
                  )}
                >
                  <div className={cn(
                    "rounded-lg px-4 py-3 h-full",
                    hasPositiveApr && hasUnifiedYield
                      ? "relative z-[1] bg-container"
                      : "bg-muted/30 border border-sidebar-border/60"
                  )}>
                    <h3 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">
                      APR
                    </h3>
                    {isLoading ? (
                      <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
                    ) : (
                      <div className="text-lg font-semibold font-mono text-foreground">
                        {hasUnifiedYield && hasPositiveApr ? totalAprFormatted : poolStats.apr}
                      </div>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="p-0 bg-popover border border-sidebar-border rounded-lg shadow-lg"
              >
                <APRBreakdownTooltip
                  swapApr={poolApr}
                  unifiedYieldApr={unifiedYieldApr}
                  token0Symbol={token0Symbol}
                  token1Symbol={token1Symbol}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </>
  );
});

/**
 * Compact stats row for mobile or condensed views.
 */
export const PoolDetailStatsCompact = memo(function PoolDetailStatsCompact({
  poolStats,
  loading,
}: PoolDetailStatsProps) {
  const isLoading = loading || poolStats.tvlFormatted === "Loading...";

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatItem
        title="TVL"
        value={poolStats.tvlFormatted}
        loading={isLoading}
      />
      <StatItem
        title="Volume (24h)"
        value={poolStats.volume24hFormatted}
        loading={isLoading}
      />
      <StatItem
        title="Fees (24h)"
        value={poolStats.fees24hFormatted}
        loading={isLoading}
      />
      <StatItem
        title="APR"
        value={poolStats.apr}
        loading={isLoading}
        highlight={poolStats.apr !== "0.00%"}
      />
    </div>
  );
});
