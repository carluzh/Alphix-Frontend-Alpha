"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ChartType } from "./hooks";
import type { TimePeriod } from "./types";

/**
 * Chart type tabs - simple tab buttons (Fee/Volume/TVL)
 */
interface ChartTypeTabsProps {
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  disabled?: boolean;
  /** Hide Yield tab (Volatile pools have no lending yield) */
  hideYield?: boolean;
}

export const ChartTypeTabs = memo(function ChartTypeTabs({ chartType, onChartTypeChange, disabled, hideYield }: ChartTypeTabsProps) {
  const tabs = [
    { type: ChartType.FEE, label: "Dynamic Fee" },
    ...(!hideYield ? [{ type: ChartType.YIELD, label: "Yield" }] : []),
    { type: ChartType.VOLUME, label: "Volume" },
    { type: ChartType.TVL, label: "TVL" },
  ];

  return (
    <div className={cn("flex flex-row items-center gap-1", disabled && "opacity-50 pointer-events-none")}>
      {tabs.map((tab) => (
        <button
          key={tab.type}
          onClick={() => onChartTypeChange(tab.type)}
          disabled={disabled}
          className={cn(
            "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
            chartType === tab.type
              ? "bg-muted/50 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
});

/**
 * Time period selector - matches PortfolioChart's TimeFrameSelector
 */
interface TimePeriodSelectorProps {
  period: TimePeriod;
  onPeriodChange: (period: TimePeriod) => void;
  disabled?: boolean;
  /** Show 1D option (only for Volatile pool Fee chart) */
  show1D?: boolean;
}

export const TimePeriodSelector = memo(function TimePeriodSelector({ period, onPeriodChange, disabled, show1D }: TimePeriodSelectorProps) {
  const options: TimePeriod[] = show1D ? ["1D", "1W", "1M"] : ["1W", "1M"];

  return (
    <div className={cn("flex flex-row items-center gap-1", disabled && "opacity-50 pointer-events-none")}>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onPeriodChange(opt)}
          disabled={disabled}
          className={cn(
            "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
            period === opt
              ? "bg-muted/50 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
});
