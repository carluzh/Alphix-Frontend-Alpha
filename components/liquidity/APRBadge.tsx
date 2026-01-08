"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { PointsTooltip, TooltipSize } from "./PointsCampaign/PointsTooltip";
import { formatPercent } from "./PointsCampaign/formatters";
import { POINTS_CAMPAIGN_ICON } from "./PointsCampaign/constants";

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
}

function TokenPairLogo({ token0Symbol, token1Symbol }: { token0Symbol?: string; token1Symbol?: string }) {
  const icon0 = (getToken(token0Symbol || '') as any)?.icon;
  const icon1 = (getToken(token1Symbol || '') as any)?.icon;

  return (
    <div className="flex items-center -space-x-1">
      {icon0 ? <Image src={icon0} alt="" width={14} height={14} className="rounded-full ring-1 ring-popover" /> : <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />}
      {icon1 ? <Image src={icon1} alt="" width={14} height={14} className="rounded-full ring-1 ring-popover" /> : <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />}
    </div>
  );
}

function APRBreakdownTooltip({ breakdown, token0Symbol, token1Symbol }: { breakdown: APRBreakdown; token0Symbol?: string; token1Symbol?: string }) {
  const { poolApr, pointsApr, lendingApr } = breakdown;

  return (
    <div className="flex flex-col py-1 min-w-[180px]">
      {poolApr !== undefined && (
        <div className="flex items-center justify-between px-2.5 py-1.5 gap-3">
          <div className="flex items-center gap-2">
            <TokenPairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />
            <span className="text-xs text-muted-foreground">Pool APR</span>
          </div>
          <span className="text-xs text-foreground font-mono">{formatPercent(poolApr)}</span>
        </div>
      )}

      {pointsApr !== undefined && pointsApr > 0 && (
        <div className="flex items-center justify-between px-2.5 py-1.5 gap-3 bg-primary/10 rounded-lg mx-1 mt-1">
          <div className="flex items-center gap-2">
            <Image src={POINTS_CAMPAIGN_ICON} alt="Points" width={14} height={14} className="rounded-full" />
            <span className="text-xs text-primary">Points APR</span>
          </div>
          <span className="text-xs text-primary font-mono">{formatPercent(pointsApr)}</span>
        </div>
      )}

      {lendingApr !== undefined && lendingApr > 0 && (
        <div className="flex items-center justify-between px-2.5 py-1.5 gap-3 rounded-lg mx-1 mt-1" style={{ backgroundColor: '#9896FF' }}>
          <div className="flex items-center gap-2">
            <Image src="/aave/Logomark-light.png" alt="Aave" width={14} height={14} className="rounded-full" />
            <span className="text-xs font-medium" style={{ color: '#E2E0FF' }}>Lending APR</span>
          </div>
          <span className="text-xs font-mono" style={{ color: '#E2E0FF' }}>{formatPercent(lendingApr)}</span>
        </div>
      )}
    </div>
  );
}

export function APRBadge({ apr, isLoading, className, breakdown, token0Symbol, token1Symbol }: APRBadgeProps) {
  if (isLoading) {
    return <div className={cn("h-7 w-[72px] bg-muted/60 rounded animate-pulse", className)} />;
  }

  const totalApr = breakdown
    ? (breakdown.poolApr ?? 0) + (breakdown.pointsApr ?? 0) + (breakdown.lendingApr ?? 0)
    : apr;

  if (totalApr === undefined || totalApr === null) {
    return (
      <div className={cn("inline-flex items-center justify-center h-7 w-[72px] rounded text-sm font-semibold font-mono bg-muted/40 text-muted-foreground", className)}>
        —
      </div>
    );
  }

  const isZeroApr = totalApr === 0;
  const formattedApr = totalApr < 1000 ? `${totalApr.toFixed(2)}%` : `${(totalApr / 1000).toFixed(2)}K%`;

  const badge = (
    <div className={cn(
      "inline-flex items-center justify-center h-7 w-[72px] rounded text-sm font-semibold font-mono",
      isZeroApr ? "bg-muted/40 text-muted-foreground" : "bg-green-500/15 text-green-500",
      className
    )}>
      {formattedApr}
    </div>
  );

  if (breakdown && (breakdown.poolApr !== undefined || breakdown.pointsApr || breakdown.lendingApr)) {
    return (
      <PointsTooltip
        content={<APRBreakdownTooltip breakdown={breakdown} token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
        size={TooltipSize.Small}
        padding={0}
        placement="top"
      >
        {badge}
      </PointsTooltip>
    );
  }

  return badge;
}
