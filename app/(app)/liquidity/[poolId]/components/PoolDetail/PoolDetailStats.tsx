"use client";

import { memo, ReactNode, useMemo } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { StatSectionBubble } from "../shared/DetailBubble";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getToken } from "@/lib/pools-config";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";
import type { PoolStats } from "../../hooks";

// Points campaign gives 50% APR bonus
const POINTS_APR_MULTIPLIER = 0.5;

interface PoolDetailStatsProps {
  poolStats: PoolStats;
  loading?: boolean;
  /** Whether this pool earns points (shows points badge on APR) */
  hasPointsRewards?: boolean;
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
  hasPointsRewards = true, // Default true for Alphix pools
  token0Symbol,
  token1Symbol,
}: PoolDetailStatsProps) {
  const isLoading = loading || poolStats.tvlFormatted === "Loading...";
  const hasPositiveApr = poolStats.apr !== "0.00%" && poolStats.aprRaw > 0;

  // Calculate APR values with points
  const { poolApr, pointsApr, totalApr, totalAprFormatted } = useMemo(() => {
    const rawApr = poolStats.aprRaw || 0;
    const pointsBonus = hasPointsRewards ? rawApr * POINTS_APR_MULTIPLIER : 0;
    const total = rawApr + pointsBonus;

    return {
      poolApr: rawApr,
      pointsApr: pointsBonus,
      totalApr: total,
      totalAprFormatted: total > 0 ? `${total.toFixed(2)}%` : "0.00%",
    };
  }, [poolStats.aprRaw, hasPointsRewards]);

  // Get token icons for tooltip
  const token0Config = token0Symbol ? getToken(token0Symbol) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol) : null;
  const icon0 = (token0Config as any)?.icon;
  const icon1 = (token1Config as any)?.icon;

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

          {/* Fees 24h */}
          <div className={statCardClass}>
            <h3 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">
              FEES (24H)
            </h3>
            {isLoading ? (
              <div className="h-6 w-20 bg-muted/60 rounded animate-pulse" />
            ) : (
              <div className="text-lg font-semibold font-mono">
                {poolStats.fees24hFormatted}
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
                    hasPositiveApr && hasPointsRewards && "input-gradient-hover input-gradient-always-visible overflow-visible m-px cursor-pointer"
                  )}
                >
                  <div className={cn(
                    "rounded-lg px-4 py-3 h-full",
                    hasPositiveApr && hasPointsRewards
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
                        {hasPointsRewards && hasPositiveApr ? totalAprFormatted : poolStats.apr}
                      </div>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              {hasPointsRewards && hasPositiveApr && (
                <TooltipContent
                  side="bottom"
                  className="p-0 bg-popover border border-sidebar-border rounded-lg shadow-lg"
                >
                  <div className="flex flex-col py-1 min-w-[180px]">
                    {/* Pool APR Row - with token images */}
                    <div className="flex items-center justify-between px-2.5 py-1.5 gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className="flex items-center -space-x-1 flex-shrink-0">
                          {icon0 ? (
                            <Image
                              src={icon0}
                              alt={token0Symbol || ''}
                              width={14}
                              height={14}
                              className="rounded-full ring-1 ring-popover"
                            />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
                          )}
                          {icon1 ? (
                            <Image
                              src={icon1}
                              alt={token1Symbol || ''}
                              width={14}
                              height={14}
                              className="rounded-full ring-1 ring-popover"
                            />
                          ) : (
                            <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">Pool APR</span>
                      </div>
                      <span className="text-xs text-foreground flex-shrink-0 font-mono">
                        {poolApr.toFixed(2)}%
                      </span>
                    </div>

                    {/* Points APR Row - with backdrop and PointsIcon */}
                    <div className="flex items-center justify-between px-2.5 py-1.5 gap-3 bg-primary/10 rounded-lg mx-1 mt-1">
                      <div className="flex items-center gap-2 flex-1">
                        <PointsIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                        <span className="text-xs text-primary">Points APR</span>
                      </div>
                      <span className="text-xs text-primary flex-shrink-0 font-mono">
                        {pointsApr.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              )}
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
