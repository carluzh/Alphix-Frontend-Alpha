"use client";

import { memo } from "react";
import { IconPlus } from "nucleo-micro-bold-essential";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PoolDetailActionsProps {
  onAddLiquidity: () => void;
  isMobile?: boolean;
  className?: string;
}

/**
 * Pool detail action buttons.
 * Adapted from Uniswap's PoolDetailsStatsButtons pattern.
 * @see interface/apps/web/src/components/Pools/PoolDetails/PoolDetailsStatsButtons.tsx
 */
export const PoolDetailActions = memo(function PoolDetailActions({
  onAddLiquidity,
  isMobile,
  className,
}: PoolDetailActionsProps) {
  if (isMobile) {
    // Mobile: Fixed bottom button
    return (
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-sidebar-border z-40",
          className
        )}
      >
        <Button
          onClick={onAddLiquidity}
          className="w-full h-12 text-base font-medium bg-button-primary hover:bg-button-primary/90"
        >
          <IconPlus className="h-5 w-5 mr-2" />
          Add Liquidity
        </Button>
      </div>
    );
  }

  // Desktop: Inline button
  return (
    <Button
      onClick={onAddLiquidity}
      className={cn(
        "h-10 px-4 font-medium bg-button-primary hover:bg-button-primary/90",
        className
      )}
    >
      <IconPlus className="h-4 w-4 mr-2" />
      Add Liquidity
    </Button>
  );
});
