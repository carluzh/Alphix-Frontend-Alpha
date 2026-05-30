"use client";

import { cn } from "@/lib/utils";
import { formatFeeValue, SURFACE1_COLOR } from "./chart-utils";

/**
 * Custom dot renderer for last data point with pulsating animation
 * Matches LiveDotRenderer.tsx animation pattern
 */
interface CustomDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  dataLength: number;
  color: string;
  isHovering: boolean;
}

export function LastPointPulsatingDot({ cx, cy, index, dataLength, color, isHovering }: CustomDotProps) {
  // Only render for the last data point and when not hovering
  if (index !== dataLength - 1 || isHovering || cx === undefined || cy === undefined) {
    return null;
  }

  return (
    <g>
      {/* Inject keyframes animation */}
      <style>
        {`
          @keyframes live-dot-pulse-svg {
            0% {
              transform: scale(1);
              opacity: 0.5;
            }
            75% {
              transform: scale(3);
              opacity: 0;
            }
            100% {
              transform: scale(3);
              opacity: 0;
            }
          }
        `}
      </style>
      {/* Outer pulsing ring 1 */}
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: "live-dot-pulse-svg 2s ease-in-out infinite",
        }}
      />
      {/* Outer pulsing ring 2 (delayed) */}
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: "live-dot-pulse-svg 2s ease-in-out infinite 0.5s",
        }}
      />
      {/* Inner solid dot with border */}
      <circle cx={cx} cy={cy} r={5} fill={color} stroke={SURFACE1_COLOR} strokeWidth={2} />
    </g>
  );
}

/**
 * Delta display component (like Uniswap's Delta.tsx)
 */
export function DeltaDisplay({ delta }: { delta: number }) {
  if (!Number.isFinite(delta) || delta === 0) return null;

  const isPositive = delta > 0;
  const color = isPositive ? "text-green-500" : "text-red-500";
  const arrow = isPositive ? "↑" : "↓";

  return (
    <span className={cn("flex items-center gap-0.5 tabular-nums", color)}>
      <span>{arrow}</span>
      <span>{Math.abs(delta).toFixed(2)}%</span>
    </span>
  );
}

/**
 * Fee change display - shows daily change and percentage
 * Format: ↑ +0.05% (15.00%)
 */
export function FeeChangeDisplay({ change, delta }: { change: number; delta: number }) {
  if (!Number.isFinite(change) && !Number.isFinite(delta)) return null;

  const isPositive = change >= 0;
  const color = isPositive ? "text-green-500" : "text-red-500";
  const arrow = isPositive ? "↑" : "↓";

  // Format the fee change with proper decimals
  const changeStr = formatFeeValue(Math.abs(change));

  // Format the percentage change
  const deltaStr = Math.abs(delta).toFixed(2);

  return (
    <span className={cn("flex items-center gap-1 tabular-nums", color)}>
      <span>{arrow}</span>
      <span>{isPositive ? "+" : "-"}{changeStr}%</span>
      <span className="text-muted-foreground">({deltaStr}%)</span>
    </span>
  );
}
