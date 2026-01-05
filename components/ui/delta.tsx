"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

// Delta arrow icons matching Uniswap's style
function ArrowUp({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8 3.33334L8 12.6667"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.33334 8L8 3.33334L12.6667 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDown({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8 12.6667L8 3.33334"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.6667 8L8 12.6667L3.33334 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Calculate percent delta between two values
 * Returns undefined for invalid inputs (like division by zero or NaN)
 */
export function calculateDelta(start: number, current: number): number | undefined {
  const delta = (current / start - 1) * 100;
  return isValidDelta(delta) ? delta : undefined;
}

/**
 * Check if delta value is valid (not null, undefined, Infinity, or NaN)
 */
function isValidDelta(delta: number | null | undefined): delta is number {
  return delta !== null && delta !== undefined && delta !== Infinity && !isNaN(delta);
}

/**
 * Check if formatted delta string represents zero
 */
function isDeltaZero(formattedDelta: string): boolean {
  return parseFloat(formattedDelta) === 0;
}

interface DeltaArrowProps {
  /** The numeric delta value (can be negative) */
  delta?: number | null;
  /** The formatted delta string (e.g., "5.23%") */
  formattedDelta: string;
  /** If true, uses neutral color instead of green/red */
  noColor?: boolean;
  /** Icon size in pixels */
  size?: number;
}

/**
 * DeltaArrow - Renders up/down arrow based on delta direction
 * Matches Uniswap's Delta.tsx styling exactly:
 * - Green (statusSuccess) for positive
 * - Red (statusCritical) for negative
 * - Neutral for zero or when noColor=true
 */
export const DeltaArrow = memo(function DeltaArrow({
  delta,
  formattedDelta,
  noColor = false,
  size = 16,
}: DeltaArrowProps) {
  if (!isValidDelta(delta)) {
    return null;
  }

  const isZero = isDeltaZero(formattedDelta);
  const isNegative = Math.sign(delta) < 0 && !isZero;

  // Color classes matching Uniswap's statusSuccess/statusCritical
  const colorClass = noColor || isZero
    ? "text-muted-foreground"
    : isNegative
      ? "text-red-500"
      : "text-green-500";

  return isNegative ? (
    <ArrowDown size={size} className={colorClass} />
  ) : (
    <ArrowUp size={size} className={colorClass} />
  );
});

interface DeltaTextProps {
  /** The numeric delta value (can be negative) */
  delta?: number;
  /** Additional class names */
  className?: string;
  /** Content to render */
  children: React.ReactNode;
}

/**
 * DeltaText - Renders text with delta-based coloring
 * Matches Uniswap's DeltaText styled component:
 * - Green (statusSuccess) for positive
 * - Red (statusCritical) for negative
 * - Neutral for zero or undefined
 */
export const DeltaText = memo(function DeltaText({
  delta,
  className,
  children,
}: DeltaTextProps) {
  const getColorClass = () => {
    if (delta === undefined || delta === 0) {
      return "text-muted-foreground";
    }
    return Math.sign(delta) < 0 ? "text-red-500" : "text-green-500";
  };

  return (
    <span className={cn(getColorClass(), className)}>
      {children}
    </span>
  );
});

/**
 * Format a number as percentage
 */
export function formatPercent(value: number): string {
  if (!isFinite(value)) return "0.00%";
  return `${Math.abs(value).toFixed(2)}%`;
}

interface DeltaDisplayProps {
  /** The numeric delta value (can be negative) */
  delta?: number | null;
  /** If true, uses neutral color */
  noColor?: boolean;
  /** Arrow size in pixels */
  arrowSize?: number;
  /** Additional class names for the container */
  className?: string;
  /** Label to show after percentage (e.g., "today") */
  label?: string;
}

/**
 * DeltaDisplay - Combined arrow + percentage text display
 * Matches Uniswap's ExploreStatsSection.tsx pattern
 */
export const DeltaDisplay = memo(function DeltaDisplay({
  delta,
  noColor = false,
  arrowSize = 12,
  className,
  label,
}: DeltaDisplayProps) {
  if (!isValidDelta(delta)) {
    return null;
  }

  const formattedDelta = formatPercent(delta);
  const isNegative = Math.sign(delta) < 0;
  const isZero = delta === 0;

  const colorClass = noColor || isZero
    ? "text-muted-foreground"
    : isNegative
      ? "text-red-500"
      : "text-green-500";

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <DeltaArrow
        delta={delta}
        formattedDelta={formattedDelta}
        noColor={noColor}
        size={arrowSize}
      />
      <span className={cn("text-xs", colorClass)}>
        {formattedDelta}
        {label && <span className="text-muted-foreground"> {label}</span>}
      </span>
    </div>
  );
});
