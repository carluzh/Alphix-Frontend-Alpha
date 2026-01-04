"use client";

import React, { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Plus, Send, MoreHorizontal } from "lucide-react";

// ============================================================================
// CONSTANTS (Matching Uniswap exactly)
// ============================================================================
const ACTION_TILE_GAP = 12; // px
const OVERVIEW_RIGHT_COLUMN_WIDTH = 360; // px

// ============================================================================
// WIGGLE ANIMATION CSS
// Matches Uniswap's wiggle effect exactly:
// - Rotation: 0 → 10deg → -5deg → 0
// - Scale: 1 → 1.05 → 1.1 → 1.06
// - Duration: 500ms, ease-in-out
// ============================================================================
const wiggleKeyframes = `
@keyframes wiggle {
  0% {
    transform: rotate(0deg) scale(1);
  }
  30% {
    transform: rotate(10deg) scale(1.05);
  }
  60% {
    transform: rotate(-5deg) scale(1.1);
  }
  100% {
    transform: rotate(0deg) scale(1.06);
  }
}
`;

// ============================================================================
// ACTION TILE COMPONENT
// ============================================================================
interface ActionTileProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  className?: string;
  singleRow?: boolean;
}

function ActionTile({ href, icon, label, className, singleRow }: ActionTileProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link
      href={href}
      className={cn(
        // Base flex layout
        "flex flex-col items-center justify-center gap-3",
        // Sizing
        "p-4 h-full",
        // Border and radius (Uniswap: $rounded16 = 16px)
        "rounded-2xl border border-transparent",
        // Background (Uniswap: $accent2 - we use a similar pink/magenta tint)
        "bg-pink-500/[0.08]",
        // Hover state (Uniswap: $accent2Hovered)
        "hover:bg-pink-500/[0.12] hover:cursor-pointer",
        // Animation
        "transition-colors",
        // Width for grid
        !singleRow && "w-full",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon with wiggle animation */}
      <div
        className="text-pink-500"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animationName: isHovered ? "wiggle" : "none",
          animationDuration: "0.5s",
          animationTimingFunction: "ease-in-out",
          animationFillMode: "forwards",
          animationIterationCount: 1,
        }}
      >
        {icon}
      </div>
      {/* Label (Uniswap: buttonLabel2) */}
      <span className="text-sm font-medium text-pink-500">{label}</span>
    </Link>
  );
}

// ============================================================================
// ACTION GRID COMPONENT
// ============================================================================
interface ActionGridProps {
  className?: string;
  layout?: "2x2" | "row";
}

export function ActionGrid({ className, layout = "2x2" }: ActionGridProps) {
  const isSingleRow = layout === "row";

  return (
    <>
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: wiggleKeyframes }} />

      {/* Grid container */}
      <div
        className={cn(
          "flex flex-wrap",
          isSingleRow && "flex-nowrap",
          className
        )}
        style={{
          gap: ACTION_TILE_GAP,
          width: isSingleRow ? "100%" : OVERVIEW_RIGHT_COLUMN_WIDTH,
        }}
      >
        {/* Tile wrappers with correct width */}
        <div
          className={cn(isSingleRow && "flex-1")}
          style={{
            width: isSingleRow ? "auto" : `calc(50% - ${ACTION_TILE_GAP / 2}px)`,
            flexGrow: isSingleRow ? 1 : undefined,
            flexBasis: isSingleRow ? 0 : undefined,
          }}
        >
          <ActionTile
            href="/liquidity"
            icon={<Plus className="h-6 w-6" />}
            label="Add Liquidity"
            singleRow={isSingleRow}
          />
        </div>

        <div
          className={cn(isSingleRow && "flex-1")}
          style={{
            width: isSingleRow ? "auto" : `calc(50% - ${ACTION_TILE_GAP / 2}px)`,
            flexGrow: isSingleRow ? 1 : undefined,
            flexBasis: isSingleRow ? 0 : undefined,
          }}
        >
          <ActionTile
            href="/overview"
            icon={<Send className="h-6 w-6" />}
            label="Send"
            singleRow={isSingleRow}
          />
        </div>

        <div
          className={cn(isSingleRow && "flex-1")}
          style={{
            width: isSingleRow ? "auto" : `calc(50% - ${ACTION_TILE_GAP / 2}px)`,
            flexGrow: isSingleRow ? 1 : undefined,
            flexBasis: isSingleRow ? 0 : undefined,
          }}
        >
          <ActionTile
            href="#"
            icon={<MoreHorizontal className="h-6 w-6" />}
            label="More"
            singleRow={isSingleRow}
          />
        </div>
      </div>
    </>
  );
}

export default ActionGrid;
