"use client";

/**
 * ChartSkeleton - Loading state for portfolio chart
 *
 * Based on Uniswap's interface/apps/web/src/components/Charts/LoadingState.tsx
 * Uses pure SVG with height-relative positioning for all elements.
 */

import { ReactNode } from "react";

const COLORS = {
  neutral3: "#404040",
  neutral3Light: "#555555",
};

/**
 * Renders header placeholders and axis tick skeletons
 * Matches Uniswap's ChartSkeletonAxes pattern
 */
function ChartSkeletonAxes({
  height,
  fillColor,
  tickColor,
}: {
  height: number;
  fillColor: string;
  tickColor: string;
}) {
  return (
    <g>
      {/* Header value placeholder - matches ChartHeader's text-3xl (~36px) */}
      <rect width="180" height="32" rx="4" y="12" x="12" fill={fillColor}>
        <animate
          attributeName="opacity"
          values="0.6;0.4;0.6"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </rect>
      {/* Delta/change placeholder - matches ChartHeader's second row */}
      <rect width="100" height="13" rx="4" y="52" x="12" fill={fillColor}>
        <animate
          attributeName="opacity"
          values="0.4;0.25;0.4"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </rect>
      {/* X-axis tick skeletons - positioned at bottom using percentage widths */}
      <g transform={`translate(0, ${height - 14})`}>
        <rect width="7%" height="6" rx="3" x="10%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="7%" height="6" rx="3" x="28.25%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="7%" height="6" rx="3" x="46.5%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="7%" height="6" rx="3" x="64.75%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="7%" height="6" rx="3" x="83%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
      </g>
      {/* Y-axis tick skeletons - positioned on right side */}
      <g transform="translate(0, 10)">
        <rect width="24" height="6" rx="3" y={(0 * height) / 5} x="96%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="24" height="6" rx="3" y={(1 * height) / 5} x="96%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="24" height="6" rx="3" y={(2 * height) / 5} x="96%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="24" height="6" rx="3" y={(3 * height) / 5} x="96%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <rect width="24" height="6" rx="3" y={(4 * height) / 5} x="96%" fill={tickColor}>
          <animate attributeName="opacity" values="0.6;0.3;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
      </g>
    </g>
  );
}

/**
 * Centered logo with pulse animation
 * Aligned with the y-axis coordinate system (same as ChartSkeletonAxes)
 */
function ChartLoadingLogo({ height }: { height: number }) {
  // Y-axis uses: transform="translate(0, 10)" with ticks at (n * height) / 5
  // Center vertically at the middle tick (n=2): 10 + (2 * height) / 5
  const yAxisOffset = 10;
  const logoCenterY = yAxisOffset + (2 * height) / 5;

  // X-axis ticks span 10% to ~90%, center horizontally at 46.5%
  // (matching the middle x-axis tick position)

  return (
    <g transform={`translate(0, ${logoCenterY})`}>
      <image
        href="/logos/alphix-icon-white.svg"
        x="46.5%"
        y="-16"
        width="32"
        height="32"
        opacity="0.6"
        style={{ transform: "translateX(-16px)" }}
      >
        <animate
          attributeName="opacity"
          values="0.6;0.3;0.6"
          dur="1.5s"
          repeatCount="indefinite"
        />
      </image>
    </g>
  );
}

interface ChartSkeletonProps {
  height: number;
  errorText?: ReactNode;
}

export function ChartSkeleton({ height, errorText }: ChartSkeletonProps) {
  const fillColor = errorText ? COLORS.neutral3Light : COLORS.neutral3;
  const tickColor = COLORS.neutral3;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        width="100%"
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        className="absolute inset-0"
      >
        <ChartSkeletonAxes
          height={height}
          fillColor={fillColor}
          tickColor={tickColor}
        />
        <ChartLoadingLogo height={height} />
      </svg>
      {errorText && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border border-border rounded-xl px-5 py-3 max-w-xs z-10">
          <span className="text-sm text-muted-foreground">{errorText}</span>
        </div>
      )}
    </div>
  );
}

export default ChartSkeleton;
