/**
 * APRBreakdownTooltip
 *
 * Unified tooltip for displaying APR breakdown across all APR displays.
 * Shows all three yield sources: Swap APR, Unified Yield, and Points.
 *
 * Used by: APRBadge, PoolDetailStats, PointsFeeStat, APRFeeStat
 */

"use client";

import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";

// =============================================================================
// TYPES
// =============================================================================

export interface APRBreakdownData {
  /** Swap/Pool APR from trading fees */
  swapApr?: number;
  /** Unified Yield APR (Aave lending) */
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
  if (value === undefined || value === null) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.00%";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K%`;
  return `${value.toFixed(2)}%`;
}

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

interface TooltipRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Highlight style for special rows */
  variant?: "default" | "unified" | "points";
}

/**
 * Individual row in the APR breakdown tooltip.
 */
function TooltipRow({ icon, label, value, variant = "default" }: TooltipRowProps) {
  const rowClasses = cn(
    "flex items-center justify-between px-2.5 py-1.5 gap-3",
    variant === "unified" && "bg-[#9896FF]/15 rounded-lg mx-1 mt-1",
    variant === "points" && "bg-primary/10 rounded-lg mx-1 mt-1"
  );

  const labelClasses = cn(
    "text-xs",
    variant === "default" && "text-muted-foreground",
    variant === "unified" && "text-[#B8B6FF]",
    variant === "points" && "text-primary"
  );

  const valueClasses = cn(
    "text-xs flex-shrink-0 font-mono",
    variant === "default" && "text-foreground",
    variant === "unified" && "text-[#B8B6FF]",
    variant === "points" && "text-primary"
  );

  return (
    <div className={rowClasses}>
      <div className="flex items-center gap-2 flex-1">
        <div className="flex-shrink-0">{icon}</div>
        <span className={labelClasses}>{label}</span>
      </div>
      <span className={valueClasses}>{value}</span>
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
 * - Unified Yield: Aave logo, purple highlight
 * - Points: Points icon, primary/orange highlight
 */
export function APRBreakdownTooltip({
  swapApr,
  unifiedYieldApr,
  pointsApr,
  token0Symbol,
  token1Symbol,
}: APRBreakdownTooltipProps) {
  return (
    <div className="flex flex-col py-1 min-w-[180px]">
      {/* Swap APR Row - always visible */}
      <TooltipRow
        icon={<TokenPairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
        label="Swap APR"
        value={formatPercent(swapApr)}
        variant="default"
      />

      {/* Unified Yield Row - always visible */}
      <TooltipRow
        icon={
          <Image
            src="/aave/Logomark-light.png"
            alt="Aave"
            width={14}
            height={14}
            className="rounded-full"
          />
        }
        label="Unified Yield"
        value={formatPercent(unifiedYieldApr)}
        variant="unified"
      />

      {/* Points Row - always visible */}
      <TooltipRow
        icon={<PointsIcon className="w-3.5 h-3.5 text-primary" />}
        label="Points"
        value={formatPercent(pointsApr)}
        variant="points"
      />
    </div>
  );
}

export default APRBreakdownTooltip;
