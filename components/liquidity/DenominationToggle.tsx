/**
 * DenominationToggle
 *
 * A pill-style toggle for switching between token0 and token1 as the price denomination base.
 * Shows token icons and symbols in a clean pill design.
 */

"use client"

import React from 'react';
import Image from 'next/image';
import { cn, getTokenIcon } from '@/lib/utils';

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
 * Denomination toggle component with token icons.
 * Displays both tokens as selectable options in a pill.
 */
export function DenominationToggle({
  token0Symbol,
  token1Symbol,
  activeBase,
  onToggle,
  className,
}: DenominationToggleProps) {
  const icon0 = getTokenIcon(token0Symbol);
  const icon1 = getTokenIcon(token1Symbol);

  return (
    <div
      className={cn(
        "flex items-center rounded-md border border-sidebar-border bg-muted/20 p-0.5",
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
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all",
          activeBase === token0Symbol
            ? "bg-muted/60 text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Image
          src={icon0}
          alt={token0Symbol}
          width={16}
          height={16}
          className="rounded-full"
        />
        <span className="text-xs font-medium">{token0Symbol}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(token1Symbol);
        }}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all",
          activeBase === token1Symbol
            ? "bg-muted/60 text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Image
          src={icon1}
          alt={token1Symbol}
          width={16}
          height={16}
          className="rounded-full"
        />
        <span className="text-xs font-medium">{token1Symbol}</span>
      </button>
    </div>
  );
}
