"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowLeftRight, Plus, Wallet, MoreHorizontal } from "lucide-react";

interface ActionTileProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  className?: string;
}

/**
 * Individual action tile
 * Following Uniswap's action tile pattern with Alphix styling
 */
function ActionTile({ href, icon, label, description, className }: ActionTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-center p-4",
        "rounded-lg border border-sidebar-border bg-container",
        "hover:bg-muted/30 hover:border-white/20 transition-colors",
        "min-h-[80px]",
        className
      )}
    >
      <div className="text-muted-foreground mb-2">{icon}</div>
      <div className="text-sm font-medium text-foreground">{label}</div>
      {description && (
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      )}
    </Link>
  );
}

interface ActionGridProps {
  className?: string;
  /**
   * Layout mode:
   * - "2x2": 2x2 grid (default, matches Uniswap)
   * - "row": Single row of 4
   */
  layout?: "2x2" | "row";
}

/**
 * Action tiles grid component
 * Adapted from Uniswap's OverviewActionTiles.tsx
 *
 * Displays quick action buttons:
 * - Swap
 * - Add Liquidity
 * - Portfolio (wallet view)
 * - More (placeholder for future actions)
 */
export function ActionGrid({ className, layout = "2x2" }: ActionGridProps) {
  const gridClass = layout === "2x2"
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-4 gap-3";

  return (
    <div className={cn(gridClass, className)}>
      <ActionTile
        href="/swap"
        icon={<ArrowLeftRight className="h-5 w-5" />}
        label="Swap"
      />
      <ActionTile
        href="/liquidity"
        icon={<Plus className="h-5 w-5" />}
        label="Add Liquidity"
      />
      <ActionTile
        href="/portfolio"
        icon={<Wallet className="h-5 w-5" />}
        label="Portfolio"
      />
      <ActionTile
        href="#"
        icon={<MoreHorizontal className="h-5 w-5" />}
        label="More"
      />
    </div>
  );
}

/**
 * Compact action buttons for mobile/narrow layouts
 */
export function ActionButtonsCompact({ className }: { className?: string }) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Link
        href="/swap"
        className={cn(
          "flex-1 flex items-center justify-center gap-2 py-2 px-3",
          "rounded-md border border-sidebar-border bg-container",
          "hover:bg-muted/30 transition-colors",
          "text-sm font-medium text-foreground"
        )}
      >
        <ArrowLeftRight className="h-4 w-4" />
        Swap
      </Link>
      <Link
        href="/liquidity"
        className={cn(
          "flex-1 flex items-center justify-center gap-2 py-2 px-3",
          "rounded-md border border-sidebar-border bg-container",
          "hover:bg-muted/30 transition-colors",
          "text-sm font-medium text-foreground"
        )}
      >
        <Plus className="h-4 w-4" />
        Add
      </Link>
    </div>
  );
}

export default ActionGrid;
