"use client";

/**
 * PositionAmountsDisplay - Shows token amounts for a position
 *
 * Simple display: Left side has token image + name, right side has token amount
 * Used in Add/Withdraw liquidity modals to show current or projected position
 * Always shows both tokens even if one amount is 0 (e.g., Out of Range positions)
 */

import React from "react";
import Image from "next/image";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import type { TokenSymbol } from "@/lib/pools-config";

interface TokenAmountRow {
  symbol: string;
  amount: string;
}

interface PositionAmountsDisplayProps {
  token0: TokenAmountRow;
  token1: TokenAmountRow;
  title?: string;
  className?: string;
}

/**
 * Displays position amounts in a simple list format
 * - Token icon + name on left
 * - Token amount on right
 * - Always shows both tokens (displays 0 for OOR positions)
 */
export function PositionAmountsDisplay({
  token0,
  token1,
  title = "Position",
  className,
}: PositionAmountsDisplayProps) {
  const token0Config = getToken(token0.symbol);
  const token1Config = getToken(token1.symbol);

  const token0Icon = token0Config?.icon || "/placeholder-logo.svg";
  const token1Icon = token1Config?.icon || "/placeholder-logo.svg";

  // Check if amounts are zero for muted styling
  const token0IsZero = parseFloat(token0.amount) === 0;
  const token1IsZero = parseFloat(token1.amount) === 0;

  return (
    <div className={cn("space-y-2", className)}>
      {title && (
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      )}
      <div className="rounded-lg border border-sidebar-border/60 bg-surface p-3 space-y-2">
        {/* Token 0 - always show */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src={token0Icon}
              alt={token0.symbol}
              width={20}
              height={20}
              className="rounded-full"
            />
            <span className="text-sm font-medium">{token0.symbol}</span>
          </div>
          <span className={cn(
            "text-sm font-medium tabular-nums",
            token0IsZero && "text-muted-foreground"
          )}>
            {formatTokenDisplayAmount(token0.amount, token0.symbol as TokenSymbol)}
          </span>
        </div>
        {/* Token 1 - always show */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src={token1Icon}
              alt={token1.symbol}
              width={20}
              height={20}
              className="rounded-full"
            />
            <span className="text-sm font-medium">{token1.symbol}</span>
          </div>
          <span className={cn(
            "text-sm font-medium tabular-nums",
            token1IsZero && "text-muted-foreground"
          )}>
            {formatTokenDisplayAmount(token1.amount, token1.symbol as TokenSymbol)}
          </span>
        </div>
      </div>
    </div>
  );
}
