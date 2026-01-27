/**
 * APRBreakdownTooltip
 *
 * Unified tooltip for displaying APR breakdown across all APR displays.
 * Shows all three yield sources: Swap APR, Unified Yield, and Points.
 *
 * Used by: APRBadge, PoolDetailStats, PointsFeeStat, APRFeeStat
 */

"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { getYieldSourcesForTokens } from "@/lib/aave-rates";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";
import { YIELD_SOURCES } from "./yield-sources";

// =============================================================================
// TYPES
// =============================================================================

export interface APRBreakdownData {
  /** Swap/Pool APR from trading fees */
  swapApr?: number;
  /** Lending Yield APR (Aave lending) */
  unifiedYieldApr?: number;
  /** Points APR bonus */
  pointsApr?: number;
}

interface APRBreakdownTooltipProps extends APRBreakdownData {
  /** Token0 symbol (for pair display) */
  token0Symbol?: string;
  /** Token1 symbol (for pair display) */
  token1Symbol?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null) return "-";
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0.00%";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K%`;
  return `${value.toFixed(2)}%`;
}

/** Aave purple color for label text */
const AAVE_TEXT_COLOR = "#B8B6FF";
/** Spark orange color for value text */
const SPARK_TEXT_COLOR = "#FAA43B";

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface TokenPairLogoProps {
  token0Symbol?: string;
  token1Symbol?: string;
}

/**
 * Displays overlapping token logos for the pair.
 */
function TokenPairLogo({ token0Symbol, token1Symbol }: TokenPairLogoProps) {
  const token0Config = token0Symbol ? getToken(token0Symbol) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol) : null;

  const icon0 = (token0Config as any)?.icon;
  const icon1 = (token1Config as any)?.icon;

  return (
    <div className="flex items-center -space-x-1">
      {icon0 ? (
        <Image
          src={icon0}
          alt={token0Symbol || ""}
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
          alt={token1Symbol || ""}
          width={14}
          height={14}
          className="rounded-full ring-1 ring-popover"
        />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
      )}
    </div>
  );
}

/**
 * Stacked lending source icons (like TokenStack).
 * Shows Spark on bottom, Aave on top when both are present.
 * Exported for use in other components.
 */
export function LendingSourceIcons({ sources }: { sources: Array<'aave' | 'spark'> }) {
  const hasAave = sources.includes('aave');
  const hasSpark = sources.includes('spark');

  if (hasAave && hasSpark) {
    return (
      <div className="relative flex items-center" style={{ width: 22, height: 14 }}>
        <Image
          src={YIELD_SOURCES.spark.logo}
          alt="Spark"
          width={14}
          height={14}
          className="absolute left-0 rounded-full ring-1 ring-popover"
          style={{ zIndex: 1 }}
          loading="eager"
        />
        <Image
          src={YIELD_SOURCES.aave.logo}
          alt="Aave"
          width={14}
          height={14}
          className="absolute left-2 rounded-full ring-1 ring-popover"
          style={{ zIndex: 2 }}
          loading="eager"
        />
      </div>
    );
  }

  const source = hasSpark ? 'spark' : 'aave';
  return (
    <Image
      src={YIELD_SOURCES[source].logo}
      alt={YIELD_SOURCES[source].name}
      width={14}
      height={14}
      className="rounded-full"
      loading="eager"
    />
  );
}

interface TooltipRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

/**
 * Individual row in the APR breakdown tooltip.
 */
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

/**
 * Unified APR breakdown tooltip.
 * Always displays all three yield sources: Swap APR, Unified Yield, Points.
 *
 * Design matches the Yield Breakdown section styling:
 * - Swap APR: Token pair logo, muted text
 * - Unified Yield: Aave logo, purple highlight (or gradient when both sources)
 * - Points: Points icon, primary/orange highlight
 */
export function APRBreakdownTooltip({
  swapApr,
  unifiedYieldApr,
  pointsApr,
  token0Symbol,
  token1Symbol,
}: APRBreakdownTooltipProps) {
  // Derive yield sources from token symbols - no prop drilling needed
  const yieldSources = useMemo(
    () => getYieldSourcesForTokens(token0Symbol, token1Symbol),
    [token0Symbol, token1Symbol]
  );
  const hasBothSources = yieldSources.includes('aave') && yieldSources.includes('spark');
  const labelStyle = { color: AAVE_TEXT_COLOR };
  const valueStyle = hasBothSources ? { color: SPARK_TEXT_COLOR } : { color: AAVE_TEXT_COLOR };

  return (
    <div className="flex flex-col py-1 min-w-[180px]">
      {/* Swap APR Row - always visible */}
      <TooltipRow
        icon={<TokenPairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
        label="Swap APR"
        value={formatPercent(swapApr)}
      />

      {/* Lending Yield Row - only show for positions that can earn it */}
      {unifiedYieldApr > 0 && (
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
            {formatPercent(unifiedYieldApr)}
          </span>
        </div>
      )}

      {/* Points Row - + left muted, Icon+Points right white */}
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

export default APRBreakdownTooltip;
