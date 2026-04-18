"use client";

import { cn } from "@/lib/utils";
import { calculateTotalApy, formatTotalApy } from "@/lib/apr";
import { PointsTooltip, TooltipSize } from "./PointsCampaign/PointsTooltip";
import { APYBreakdownTooltip } from "./APYBreakdownTooltip";

export interface APYBreakdown {
  poolApy?: number;
  pointsApy?: number;
  lendingApy?: number;
}


interface APYBadgeProps {
  apy?: number;
  isLoading?: boolean;
  className?: string;
  breakdown?: APYBreakdown;
  token0Symbol?: string;
  token1Symbol?: string;
}

export function APYBadge({ apy, isLoading, className, breakdown, token0Symbol, token1Symbol }: APYBadgeProps) {
  if (isLoading) {
    return <div className={cn("h-7 min-w-[72px] px-3 bg-muted/60 rounded animate-pulse", className)} />;
  }

  const totalApy = breakdown
    ? calculateTotalApy({
        swapApy: breakdown.poolApy,
        unifiedYieldApy: breakdown.lendingApy,
        pointsApy: breakdown.pointsApy,
      })
    : apy ?? null;

  if (totalApy === null) {
    return (
      <span className={cn("inline-flex items-center justify-center h-7 min-w-[72px] px-3 rounded text-sm font-semibold font-mono bg-muted/40 text-muted-foreground", className)}>
        -
      </span>
    );
  }

  const isZero = totalApy === 0;
  const formattedApy = breakdown
    ? formatTotalApy({
        swapApy: breakdown.poolApy,
        unifiedYieldApy: breakdown.lendingApy,
        pointsApy: breakdown.pointsApy,
      })
    : formatTotalApy({ swapApy: totalApy });

  const badge = (
    <span className={cn(
      "inline-flex items-center justify-center h-7 min-w-[72px] px-3 rounded text-sm font-semibold font-mono",
      isZero ? "bg-muted/40 text-muted-foreground" : "bg-green-500/15 text-green-500",
      className
    )}>
      {formattedApy}
    </span>
  );

  return (
    <PointsTooltip
      content={
        <APYBreakdownTooltip
          swapApy={breakdown?.poolApy}
          unifiedYieldApy={breakdown?.lendingApy}
          pointsApy={breakdown?.pointsApy}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
        />
      }
      size={TooltipSize.Small}
      padding={0}
      placement="top"
    >
      {badge}
    </PointsTooltip>
  );
}

