"use client";

import { memo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Separator } from "../shared/Separator";

interface PortfolioTabInfo {
  path: string;
  label: string;
}

// Tab configuration - Overview only
const PORTFOLIO_TABS: PortfolioTabInfo[] = [
  { path: "/portfolio", label: "Overview" },
];

/**
 * PortfolioTabs - matches Uniswap's Tabs.tsx exactly
 *
 * Styling:
 * - Flex row, left-aligned, gap 24px desktop / 12px mobile
 * - Text: 14px (text-sm), font-weight 400
 * - Active: foreground color with 2px bottom border
 * - Inactive: muted-foreground, transparent border
 */
export const PortfolioTabs = memo(function PortfolioTabs() {
  const pathname = usePathname();

  // Determine active tab based on pathname
  const getIsActive = (tabPath: string) => {
    if (!pathname) return false;
    if (tabPath === "/portfolio") {
      return pathname === "/portfolio" || pathname === "/portfolio/";
    }
    return pathname.startsWith(tabPath);
  };

  return (
    <div className="flex flex-col">
      {/* Tab Links - left aligned with fixed gaps (24px desktop, 12px mobile) */}
      <div className="flex flex-row gap-3 sm:gap-6">
        {PORTFOLIO_TABS.map((tab) => {
          const isActive = getIsActive(tab.path);

          return (
            <Link
              key={tab.path}
              href={tab.path}
              className="no-underline"
              aria-label={`Navigate to ${tab.label}`}
            >
              <span
                className={cn(
                  // Base styling - smaller text (14px)
                  "text-sm font-normal",
                  // Padding bottom for border spacing
                  "pb-2.5 block",
                  // Border bottom
                  "border-b-2",
                  // Colors based on state
                  isActive
                    ? "text-foreground border-foreground"
                    : "text-muted-foreground border-transparent",
                  // Hover state
                  "hover:text-foreground hover:border-muted-foreground",
                  // Transition
                  "transition-colors"
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Separator */}
      <Separator />
    </div>
  );
});

export default PortfolioTabs;
