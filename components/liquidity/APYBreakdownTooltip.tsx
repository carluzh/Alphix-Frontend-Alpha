/**
 * APYBreakdownTooltip
 *
 * Unified tooltip for displaying APY breakdown across all APY displays.
 * Shows all three yield sources: Swap APY, Unified Yield, and Points.
 *
 * Used by: APYBadge, PoolDetailStats, PointsFeeStat, APRFeeStat
 */

"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { resolveTokenIcon } from "@/lib/pools-config";
import { getYieldSourcesForTokens } from "@/lib/aave-rates";
import { formatAprPercent } from "@/lib/format";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";
import { YIELD_SOURCES } from "./yield-sources";

// =============================================================================
// TYPES
// =============================================================================

export interface APYBreakdownData {
  /** Swap/Pool APY from trading fees */
  swapApy?: number;
  /** Lending Yield APY (Aave lending) */
  unifiedYieldApy?: number;
  /** Points APY bonus */
  pointsApy?: number;
}

interface APYBreakdownTooltipProps extends APYBreakdownData {
  token0Symbol?: string;
  token1Symbol?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const AAVE_TEXT_COLOR = "#B8B6FF";
const SPARK_TEXT_COLOR = "#FAA43B";

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface TokenPairLogoProps {
  token0Symbol?: string;
  token1Symbol?: string;
}

function TokenPairLogo({ token0Symbol, token1Symbol }: TokenPairLogoProps) {
  const icon0 = token0Symbol ? resolveTokenIcon(token0Symbol) : null;
  const icon1 = token1Symbol ? resolveTokenIcon(token1Symbol) : null;

  return (
    <div className="flex items-center -space-x-1">
      {icon0 ? (
        <Image src={icon0} alt={token0Symbol || ""} width={14} height={14} className="rounded-full ring-1 ring-popover" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
      )}
      {icon1 ? (
        <Image src={icon1} alt={token1Symbol || ""} width={14} height={14} className="rounded-full ring-1 ring-popover" />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
      )}
    </div>
  );
}

export function LendingSourceIcons({ sources }: { sources: Array<'aave' | 'spark'> }) {
  const hasAave = sources.includes('aave');
  const hasSpark = sources.includes('spark');

  if (hasAave && hasSpark) {
    return (
      <div className="relative flex items-center" style={{ width: 22, height: 14 }}>
        <Image src={YIELD_SOURCES.spark.logo} alt="Spark" width={14} height={14} className="absolute left-0 rounded-full" style={{ zIndex: 1 }} loading="eager" />
        <Image src={YIELD_SOURCES.aave.logo} alt="Aave" width={14} height={14} className="absolute left-2 rounded-full" style={{ zIndex: 2 }} loading="eager" />
      </div>
    );
  }

  const source = hasSpark ? 'spark' : 'aave';
  return <Image src={YIELD_SOURCES[source].logo} alt={YIELD_SOURCES[source].name} width={14} height={14} className="rounded-full" loading="eager" />;
}

interface TooltipRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function TooltipRow({ icon, label, value }: TooltipRowProps) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 gap-3">
      <div className="flex items-center gap-2 flex-1">
        <div className="flex-shrink-0">{icon}</div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-xs flex-shrink-0 font-mono text-foreground">{value}</span>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function APYBreakdownTooltip({
  swapApy,
  unifiedYieldApy,
  pointsApy,
  token0Symbol,
  token1Symbol,
}: APYBreakdownTooltipProps) {
  const yieldSources = useMemo(
    () => getYieldSourcesForTokens(token0Symbol, token1Symbol),
    [token0Symbol, token1Symbol]
  );
  const hasBothSources = yieldSources.includes('aave') && yieldSources.includes('spark');
  const labelStyle = { color: AAVE_TEXT_COLOR };
  const valueStyle = hasBothSources ? { color: SPARK_TEXT_COLOR } : { color: AAVE_TEXT_COLOR };

  return (
    <div className="flex flex-col py-1 min-w-[180px]">
      <TooltipRow
        icon={<TokenPairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
        label="Swap APY"
        value={formatAprPercent(swapApy)}
      />

      {(unifiedYieldApy ?? 0) > 0 && (
        <div
          className={cn(
            "flex items-center justify-between px-2.5 py-1.5 gap-3 rounded-lg mx-1 mt-1",
            !hasBothSources && "bg-[#9896FF]/15"
          )}
          style={hasBothSources ? {
            background: "linear-gradient(90deg, rgba(152, 150, 255, 0.15) 0%, rgba(250, 164, 59, 0.15) 100%)"
          } : undefined}
        >
          <div className="flex items-center gap-2 flex-1">
            <div className="flex-shrink-0">
              <LendingSourceIcons sources={yieldSources} />
            </div>
            <span className="text-xs" style={labelStyle}>Lending APY</span>
          </div>
          <span className="text-xs flex-shrink-0 font-mono" style={valueStyle}>
            {formatAprPercent(unifiedYieldApy)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between px-2.5 py-1.5 gap-3 bg-primary/10 rounded-lg mx-1 mt-1">
        <span className="text-xs text-muted-foreground">+</span>
        <div className="flex items-center gap-1.5">
          <PointsIcon className="w-3.5 h-3.5 text-foreground" />
          <span className="text-xs text-foreground font-mono">Points</span>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use APYBreakdownTooltip */
export const APRBreakdownTooltip = APYBreakdownTooltip;
export default APYBreakdownTooltip;
