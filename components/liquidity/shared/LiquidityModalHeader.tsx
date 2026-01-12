"use client";

/**
 * LiquidityModalHeader - Header for Add/Withdraw liquidity modals
 *
 * Displays:
 * - TokenStack (overlapping token icons)
 * - Token pair name (e.g., "aETH / aUSDC")
 * - Range badge (In Range / Out of Range)
 * - Yield badge (Unified Yield for rehypo pools)
 */

import React from "react";
import { TokenStack } from "../TokenStack";
import { cn } from "@/lib/utils";
import { getPoolById } from "@/lib/pools-config";

interface LiquidityModalHeaderProps {
  token0Symbol: string;
  token1Symbol: string;
  isInRange: boolean;
  poolId?: string;
  className?: string;
}

function RangeBadge({ isInRange }: { isInRange: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          isInRange ? "bg-green-500" : "bg-red-500"
        )}
      />
      <span
        className={cn(
          "text-xs font-medium",
          isInRange ? "text-green-500" : "text-red-500"
        )}
      >
        {isInRange ? "In Range" : "Out of Range"}
      </span>
    </div>
  );
}

function UnifiedYieldBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
    >
      Unified Yield
    </span>
  );
}

function CustomBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground">
      Custom
    </span>
  );
}

export function LiquidityModalHeader({
  token0Symbol,
  token1Symbol,
  isInRange,
  poolId,
  className,
}: LiquidityModalHeaderProps) {
  // Determine if this is a rehypo (Unified Yield) pool
  const poolConfig = poolId ? getPoolById(poolId) : null;
  const isUnifiedYield = poolConfig?.rehypoRange !== undefined;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Token Stack */}
      <TokenStack
        position={{
          token0: { symbol: token0Symbol },
          token1: { symbol: token1Symbol },
        }}
      />

      {/* Pair name and badges */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">
          {token0Symbol} / {token1Symbol}
        </span>
        <div className="flex items-center gap-2">
          <RangeBadge isInRange={isInRange} />
          {isUnifiedYield ? <UnifiedYieldBadge /> : <CustomBadge />}
        </div>
      </div>
    </div>
  );
}
