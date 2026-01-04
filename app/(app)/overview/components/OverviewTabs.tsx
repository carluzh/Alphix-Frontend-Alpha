"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type OverviewTabId = "overview" | "tokens";

interface OverviewTab {
  id: OverviewTabId;
  label: string;
  count?: number;
}

interface OverviewTabsProps {
  activeTab: OverviewTabId;
  onTabChange: (tab: OverviewTabId) => void;
  positionCount?: number;
  tokenCount?: number;
  className?: string;
}

const DEFAULT_TABS: OverviewTab[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
];

export function OverviewTabs({
  activeTab,
  onTabChange,
  tokenCount,
  className,
}: OverviewTabsProps) {
  const tabs = DEFAULT_TABS.map((tab) => {
    let count: number | undefined;
    if (tab.id === "tokens") {
      count = tokenCount;
    }
    return { ...tab, count };
  });

  return (
    <div className={cn("flex items-center border-b border-sidebar-border", className)}>
      <div className="flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative px-4 py-3 text-sm font-medium transition-colors",
              "hover:text-foreground focus:outline-none",
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs rounded-full",
                    activeTab === tab.id
                      ? "bg-sidebar-primary/20 text-sidebar-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
            {/* Active indicator */}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sidebar-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default OverviewTabs;
