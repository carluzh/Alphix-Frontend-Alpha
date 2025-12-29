/**
 * DenominationToggle
 *
 * A pill-style toggle for switching between token0 and token1 as the price denomination base.
 * Used in the pool detail page to allow users to choose their preferred price display.
 *
 * Mirrors Uniswap's price inversion toggle pattern from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionCard.tsx (pricesInverted state)
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';

interface DenominationToggleProps {
  /** Symbol of token0 */
  token0Symbol: string;
  /** Symbol of token1 */
  token1Symbol: string;
  /** Currently active base token symbol */
  activeBase: string;
  /** Callback when user toggles the denomination */
  onToggle: (newBase: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Denomination toggle component.
 * Displays both tokens with the active one highlighted.
 *
 * @example
 * ```tsx
 * <DenominationToggle
 *   token0Symbol="USDC"
 *   token1Symbol="WETH"
 *   activeBase="USDC"
 *   onToggle={(newBase) => setDenominationBase(newBase)}
 * />
 * ```
 */
export function DenominationToggle({
  token0Symbol,
  token1Symbol,
  activeBase,
  onToggle,
  className,
}: DenominationToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-muted/30 px-1 py-0.5",
        className
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(token0Symbol);
        }}
        className={cn(
          "px-1.5 py-0.5 text-[11px] rounded-full transition-all",
          activeBase === token0Symbol
            ? "bg-muted/60 text-foreground"
            : "text-muted-foreground hover:text-foreground/80"
        )}
      >
        {token0Symbol}
      </button>
      <span className="text-[11px] text-muted-foreground/60">/</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(token1Symbol);
        }}
        className={cn(
          "px-1.5 py-0.5 text-[11px] rounded-full transition-all",
          activeBase === token1Symbol
            ? "bg-muted/60 text-foreground"
            : "text-muted-foreground hover:text-foreground/80"
        )}
      >
        {token1Symbol}
      </button>
    </div>
  );
}
