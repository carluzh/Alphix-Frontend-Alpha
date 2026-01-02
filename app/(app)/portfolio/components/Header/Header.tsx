"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { AddressDisplay } from "./AddressDisplay";
import { PortfolioTabs } from "./Tabs";
import { useShouldHeaderBeCompact } from "../../hooks/useShouldHeaderBeCompact";

interface PortfolioHeaderProps {
  scrollY?: number;
}

/**
 * PortfolioHeader - Portfolio page header with address and points
 *
 * Layout:
 * - Top row: Profile (left) + Points counter (right)
 * - Bottom row: Tab navigation
 */
export const PortfolioHeader = memo(function PortfolioHeader({
  scrollY,
}: PortfolioHeaderProps) {
  const isCompact = useShouldHeaderBeCompact(scrollY);

  return (
    <div
      className={cn(
        // Background and positioning
        "bg-background",
        // Flex layout
        "flex flex-col",
        // Gap between address row and tabs
        "gap-6",
        // Transition for gap
        "transition-[gap] duration-200 ease-in-out"
      )}
    >
      {/* Top Row: Profile */}
      <div className="flex items-start justify-between">
        {/* Left: Address Display */}
        <AddressDisplay isCompact={isCompact} />
      </div>

      {/* Tabs */}
      <PortfolioTabs />
    </div>
  );
});

export default PortfolioHeader;
