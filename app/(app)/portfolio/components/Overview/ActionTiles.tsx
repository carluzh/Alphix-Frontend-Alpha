"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowLeftRight, Send, MoreHorizontal } from "lucide-react";

// Constants matching Uniswap exactly
const ACTION_TILE_GAP = 12;
const OVERVIEW_RIGHT_COLUMN_WIDTH = 360;

/**
 * Wiggle animation keyframes - matches Uniswap exactly
 * Rotation: 0 → 10deg → -5deg → 0
 * Scale: 1 → 1.05 → 1.1 → 1.06
 * Duration: 500ms, ease-in-out
 */
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

interface ActionTileProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isSingleRow?: boolean;
}

/**
 * ActionTile - matches Uniswap's ActionTile styling
 *
 * Styling:
 * - backgroundColor="$accent2" → bg-pink-500/[0.08]
 * - hover: backgroundColor="$accent2Hovered" → bg-pink-500/[0.12]
 * - borderRadius="$rounded16" → rounded-2xl
 * - padding="$spacing16" → p-4
 * - Icon: size="$icon.24" color="$accent1" → h-6 w-6 text-pink-500
 * - Text: buttonLabel2 → text-sm font-medium
 */
function ActionTile({ href, icon, label, isSingleRow }: ActionTileProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link
      href={href}
      className={cn(
        // Layout
        "flex flex-col items-center justify-center gap-3",
        // Sizing
        "p-4 h-full",
        // Border and radius
        "rounded-2xl border border-transparent",
        // Background
        "bg-pink-500/[0.08]",
        // Hover state
        "hover:bg-pink-500/[0.12] hover:cursor-pointer",
        // Transition
        "transition-colors"
      )}
      style={{
        width: isSingleRow ? "auto" : "100%",
        flexGrow: isSingleRow ? 1 : undefined,
        flexBasis: isSingleRow ? 0 : undefined,
      }}
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
      {/* Label: buttonLabel2 = text-sm font-medium */}
      <span className="text-sm font-medium text-pink-500">{label}</span>
    </Link>
  );
}

/**
 * OverviewActionTiles - matches Uniswap's ActionTiles.tsx
 *
 * 3 tiles: Swap, Send, More (per user request - no Buy tile)
 *
 * Layout:
 * - Single row with 3 equal-width tiles
 * - Gap: 12px between tiles
 * - Each tile grows equally to fill container
 */
export const OverviewActionTiles = memo(function OverviewActionTiles() {
  return (
    <>
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: wiggleKeyframes }} />

      {/* Container - single row, equal width tiles */}
      <div
        className="flex flex-row w-full"
        style={{ gap: ACTION_TILE_GAP }}
      >
        {/* Swap Tile */}
        <div className="flex-1">
          <ActionTile
            href="/swap"
            icon={<ArrowLeftRight className="h-6 w-6" />}
            label="Swap"
            isSingleRow={true}
          />
        </div>

        {/* Send Tile */}
        <div className="flex-1">
          <ActionTile
            href="/portfolio"
            icon={<Send className="h-6 w-6" />}
            label="Send"
            isSingleRow={true}
          />
        </div>

        {/* More Tile */}
        <div className="flex-1">
          <ActionTile
            href="#"
            icon={<MoreHorizontal className="h-6 w-6" />}
            label="More"
            isSingleRow={true}
          />
        </div>
      </div>
    </>
  );
});

export default OverviewActionTiles;
