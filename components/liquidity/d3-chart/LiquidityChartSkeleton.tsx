"use client";

/**
 * LiquidityChartSkeleton - Loading state for liquidity range chart
 *
 * Based on the ChartSkeleton pattern from app/(app)/overview/components/Charts/ChartSkeleton.tsx
 * Shows horizontal liquidity bars skeleton and range indicator on the right side.
 */

import { CHART_DIMENSIONS } from './constants';

const COLORS = {
  neutral3: "#404040",
  neutral3Light: "#555555",
};

interface LiquidityChartSkeletonProps {
  height?: number;
  className?: string;
}

export function LiquidityChartSkeleton({
  height = CHART_DIMENSIONS.CHART_HEIGHT,
  className,
}: LiquidityChartSkeletonProps) {
  const fillColor = COLORS.neutral3;

  // Deterministic bar widths for skeleton (avoiding hydration mismatch)
  const skeletonBars = [65, 45, 80, 55, 70, 40, 85, 50, 60, 75, 42, 68];
  const barHeight = 10;
  const barSpacing = 14;

  return (
    <div className={className} style={{ height, position: 'relative', width: '100%' }}>
      <svg
        width="100%"
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        className="absolute inset-0"
      >
        {/* Simulated liquidity bars on the right - horizontal bars growing leftward */}
        <g>
          {skeletonBars.map((width, i) => (
            <rect
              key={i}
              x={`calc(100% - ${width}px)`}
              y={15 + i * barSpacing}
              width={width - 20}
              height={barHeight}
              rx={2}
              fill={fillColor}
            >
              <animate
                attributeName="opacity"
                values="0.6;0.35;0.6"
                dur="1.5s"
                repeatCount="indefinite"
                begin={`${i * 0.08}s`}
              />
            </rect>
          ))}
        </g>

        {/* Range indicator bar on right edge */}
        <rect
          x="calc(100% - 16px)"
          y={30}
          width={12}
          height={120}
          rx={6}
          fill={fillColor}
        >
          <animate
            attributeName="opacity"
            values="0.4;0.2;0.4"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </rect>

        {/* Centered logo with pulse animation */}
        <g transform={`translate(0, ${height / 2})`}>
          <image
            href="/logos/alphix-icon-white.svg"
            x="40%"
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
      </svg>
    </div>
  );
}

export default LiquidityChartSkeleton;
