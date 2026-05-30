"use client";

import React from "react";
import { cn, getTokenIcon } from "@/lib/utils";
import { TokenImage } from "@/components/ui/token-image";
import { getPoolBySlug } from "@/lib/pools-config";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { NetworkMode } from "@/lib/network-mode";

export interface LiquidityModalHeaderProps {
  /** Position whose token pair, in-range status, and poolId drive the header. */
  position: ProcessedPosition;
  /** When true the status dot/label render green "Earning" and the
   *  in-range/out-of-range branch is bypassed (read from context by the consumer). */
  isUnifiedYield: boolean;
  /** Chain for token icon resolution + getPoolBySlug badge lookup. May be
   *  undefined at runtime (stale JSON positions). */
  networkMode: NetworkMode | undefined;
}

/**
 * Shared header for the Increase / Decrease liquidity modals: token-pair title,
 * in-range / earning status dot + label, Unified Yield / Custom badge, and the
 * overlapping double token image.
 *
 * Note: two independent UY signals are intentionally preserved — the status
 * dot/label use the consumer-provided `isUnifiedYield`, while the badge
 * independently re-derives UY from the pool config's `rehypoRange`. This mirrors
 * the original duplicated blocks exactly; do not collapse them into one.
 *
 * The wizard's ReviewExecuteModal header is deliberately NOT a consumer — it is
 * pool-config based with different badge styling and no status dot.
 */
export function LiquidityModalHeader({ position, isUnifiedYield, networkMode }: LiquidityModalHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-white">{position.token0.symbol}</span>
          <span className="text-2xl font-semibold text-muted-foreground">/</span>
          <span className="text-2xl font-semibold text-white">{position.token1.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full", isUnifiedYield ? "bg-green-500" : (position.isInRange ? "bg-green-500" : "bg-red-500"))} />
            <span className={cn("text-xs font-medium", isUnifiedYield ? "text-green-500" : (position.isInRange ? "text-green-500" : "text-red-500"))}>
              {isUnifiedYield ? "Earning" : (position.isInRange ? "In Range" : "Out of Range")}
            </span>
          </div>
          {position.poolId && (() => {
            const poolConfig = getPoolBySlug(position.poolId, networkMode);
            const isUY = poolConfig?.rehypoRange !== undefined;
            return isUY ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}>
                Unified Yield
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground">Custom</span>
            );
          })()}
        </div>
      </div>
      <div className="flex items-center -space-x-2">
        <TokenImage src={getTokenIcon(position.token0.symbol, networkMode)} alt="" size={36} />
        <TokenImage src={getTokenIcon(position.token1.symbol, networkMode)} alt="" size={36} />
      </div>
    </div>
  );
}
