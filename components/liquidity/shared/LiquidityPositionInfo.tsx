"use client";

/**
 * LiquidityPositionInfo - Display position header with tokens and status
 *
 * Following Uniswap's pattern: Displays position tokens, range, and status badge.
 * Reusable in Form and Review steps.
 *
 * @see interface/apps/web/src/components/Liquidity/LiquidityPositionInfo.tsx
 */

import React from "react";
import Image from "next/image";
import { getTokenIcon } from "../liquidity-form-utils";
import { cn } from "@/lib/utils";

export interface PositionInfoData {
  token0Symbol: string;
  token1Symbol: string;
  feeTier?: number;
  tickLower?: number;
  tickUpper?: number;
  isInRange?: boolean;
  isFullRange?: boolean;
  poolId?: string;
  positionId?: string | number;
  /** Price range display values */
  minPrice?: string;
  maxPrice?: string;
  currentPrice?: string;
}

export interface LiquidityPositionInfoProps {
  position: PositionInfoData;
  /** Size of currency logos */
  currencyLogoSize?: number;
  /** Hide the status indicator (In Range / Out of Range) */
  hideStatusIndicator?: boolean;
  /** Show as mini/compact version */
  isMiniVersion?: boolean;
  /** Make the pair name clickable to pool details */
  linkToPool?: boolean;
  /** Show fee tier badge */
  showFeeTier?: boolean;
}

/**
 * Loader skeleton for position info
 */
export function LiquidityPositionInfoLoader({ hideStatus = false }: { hideStatus?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-muted/40 animate-pulse" />
        <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-muted/40 animate-pulse" />
      </div>
      <div className="flex-1">
        <div className="h-5 w-24 bg-muted/40 rounded animate-pulse mb-1" />
        {!hideStatus && (
          <div className="h-4 w-16 bg-muted/40 rounded animate-pulse" />
        )}
      </div>
    </div>
  );
}

/**
 * Status indicator component
 */
function StatusIndicator({ isInRange, isFullRange }: { isInRange?: boolean; isFullRange?: boolean }) {
  if (isFullRange) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        Full Range
      </span>
    );
  }

  if (isInRange === undefined) return null;

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs",
      isInRange ? "text-green-500" : "text-yellow-500"
    )}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        isInRange ? "bg-green-500" : "bg-yellow-500"
      )} />
      {isInRange ? "In Range" : "Out of Range"}
    </span>
  );
}

/**
 * Fee tier badge component
 */
function FeeTierBadge({ feeTier }: { feeTier: number }) {
  // Convert basis points to percentage (e.g., 3000 -> 0.30%)
  const feePercent = feeTier / 10000;
  return (
    <span className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-medium text-muted-foreground">
      {feePercent.toFixed(2)}%
    </span>
  );
}

/**
 * Displays position info header with token pair logos and status.
 */
export function LiquidityPositionInfo({
  position,
  currencyLogoSize = 40,
  hideStatusIndicator = false,
  isMiniVersion = false,
  linkToPool = false,
  showFeeTier = true,
}: LiquidityPositionInfoProps) {
  const {
    token0Symbol,
    token1Symbol,
    feeTier,
    isInRange,
    isFullRange,
    poolId,
  } = position;

  const smallLogoSize = Math.round(currencyLogoSize * 0.55);

  const pairName = `${token0Symbol} / ${token1Symbol}`;

  const PairNameContent = (
    <span className={cn(
      "font-semibold",
      isMiniVersion ? "text-sm" : "text-base",
      linkToPool && "hover:text-primary cursor-pointer transition-colors"
    )}>
      {pairName}
    </span>
  );

  return (
    <div className={cn(
      "flex items-center gap-4",
      isMiniVersion && "gap-3"
    )}>
      {/* Split Logo */}
      <div className="relative" style={{ width: currencyLogoSize, height: currencyLogoSize }}>
        <Image
          src={getTokenIcon(token0Symbol)}
          alt={token0Symbol}
          width={currencyLogoSize}
          height={currencyLogoSize}
          className="rounded-full"
        />
        <Image
          src={getTokenIcon(token1Symbol)}
          alt={token1Symbol}
          width={smallLogoSize}
          height={smallLogoSize}
          className="absolute -right-1 -bottom-1 rounded-full border-2 border-background"
        />
      </div>

      {/* Position Details */}
      <div className={cn("flex flex-col", isMiniVersion ? "gap-0" : "gap-0.5")}>
        <div className="flex items-center gap-2">
          {linkToPool && poolId ? (
            <a href={`/liquidity/${poolId}`} className="no-underline">
              {PairNameContent}
            </a>
          ) : (
            PairNameContent
          )}

          {showFeeTier && feeTier && !isMiniVersion && (
            <FeeTierBadge feeTier={feeTier} />
          )}
        </div>

        {!hideStatusIndicator && !isMiniVersion && (
          <StatusIndicator isInRange={isInRange} isFullRange={isFullRange} />
        )}

        {isMiniVersion && showFeeTier && feeTier && (
          <div className="flex items-center gap-2">
            <FeeTierBadge feeTier={feeTier} />
            {!hideStatusIndicator && (
              <StatusIndicator isInRange={isInRange} isFullRange={isFullRange} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Extended version with price range display
 */
export function LiquidityPositionInfoExtended({
  position,
  ...props
}: LiquidityPositionInfoProps & { position: PositionInfoData & { minPrice?: string; maxPrice?: string; currentPrice?: string } }) {
  const { minPrice, maxPrice, currentPrice } = position;
  const showPriceRange = minPrice && maxPrice;

  return (
    <div className="space-y-3">
      <LiquidityPositionInfo position={position} {...props} />

      {showPriceRange && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/20 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Min Price</div>
            <div className="text-xs font-medium truncate">{minPrice}</div>
          </div>
          <div className="rounded-lg bg-muted/20 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Current</div>
            <div className="text-xs font-medium truncate">{currentPrice || "—"}</div>
          </div>
          <div className="rounded-lg bg-muted/20 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">Max Price</div>
            <div className="text-xs font-medium truncate">{maxPrice}</div>
          </div>
        </div>
      )}
    </div>
  );
}
