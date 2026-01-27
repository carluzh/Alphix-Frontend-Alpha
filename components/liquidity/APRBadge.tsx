"use client";

import { cn } from "@/lib/utils";
import { calculateTotalApr, formatTotalApr } from "@/lib/apr";
import { PointsTooltip, TooltipSize } from "./PointsCampaign/PointsTooltip";
import { APRBreakdownTooltip } from "./APRBreakdownTooltip";

export interface APRBreakdown {
  poolApr?: number;
  pointsApr?: number;
  lendingApr?: number;
}

interface APRBadgeProps {
  apr?: number;
  isLoading?: boolean;
  className?: string;
  breakdown?: APRBreakdown;
  token0Symbol?: string;
  token1Symbol?: string;
  yieldSources?: Array<'aave' | 'spark'>;
}

export function APRBadge({ apr, isLoading, className, breakdown, token0Symbol, token1Symbol, yieldSources }: APRBadgeProps) {
  if (isLoading) {
    return <div className={cn("h-7 w-[72px] bg-muted/60 rounded animate-pulse", className)} />;
  }

  // Use consolidated APR calculation
  const totalApr = breakdown
    ? calculateTotalApr({
        swapApr: breakdown.poolApr,
        unifiedYieldApr: breakdown.lendingApr,
        pointsApr: breakdown.pointsApr,
      })
    : apr ?? null;

  if (totalApr === null) {
    return (
      <div className={cn("inline-flex items-center justify-center h-7 w-[72px] rounded text-sm font-semibold font-mono bg-muted/40 text-muted-foreground", className)}>
        -
      </div>
    );
  }

  const isZeroApr = totalApr === 0;
  const formattedApr = formatTotalApr({
    swapApr: breakdown?.poolApr ?? totalApr,
    unifiedYieldApr: breakdown?.lendingApr,
    pointsApr: breakdown?.pointsApr,
  });

  const badge = (
    <div className={cn(
      "inline-flex items-center justify-center h-7 w-[72px] rounded text-sm font-semibold font-mono",
      isZeroApr ? "bg-muted/40 text-muted-foreground" : "bg-green-500/15 text-green-500",
      className
    )}>
      {formattedApr}
    </div>
  );

  // Always show tooltip with unified breakdown (maps old props to new naming)
  return (
    <PointsTooltip
      content={
        <APRBreakdownTooltip
          swapApr={breakdown?.poolApr}
          unifiedYieldApr={breakdown?.lendingApr}
          pointsApr={breakdown?.pointsApr}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          yieldSources={yieldSources}
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
