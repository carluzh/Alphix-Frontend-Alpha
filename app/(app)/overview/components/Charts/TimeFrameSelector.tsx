"use client";

/**
 * TimeFrameSelector - Ghost tab style per style.md
 * Minimal toggle buttons for switching time periods
 */

import { cn } from "@/lib/utils";
import type { ChartPeriod } from "../../hooks/useOverviewChartData";

// Re-export for convenience
export type { ChartPeriod };

interface TimeFrameOption {
  value: ChartPeriod;
  label: string;
}

// Map period to display labels (removed 1Y per requirements)
const TIME_FRAME_OPTIONS: TimeFrameOption[] = [
  { value: "DAY", label: "1D" },
  { value: "WEEK", label: "1W" },
  { value: "MONTH", label: "1M" },
];

interface TimeFrameSelectorProps {
  selectedPeriod: ChartPeriod;
  onSelectPeriod: (period: ChartPeriod) => void;
  disabled?: boolean;
  className?: string;
}

export function TimeFrameSelector({
  selectedPeriod,
  onSelectPeriod,
  disabled = false,
  className,
}: TimeFrameSelectorProps) {
  return (
    <div
      className={cn(
        "flex flex-row items-center gap-1",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      {TIME_FRAME_OPTIONS.map((option) => {
        const isSelected = selectedPeriod === option.value;

        return (
          <button
            key={option.value}
            onClick={() => onSelectPeriod(option.value)}
            disabled={disabled}
            className={cn(
              "h-7 px-2.5 text-xs rounded-md",
              "transition-colors duration-150",
              "cursor-pointer select-none",
              isSelected
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              disabled && "cursor-default"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default TimeFrameSelector;
