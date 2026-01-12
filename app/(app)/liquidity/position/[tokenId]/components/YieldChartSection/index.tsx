"use client";

import { memo, useMemo, useState, useCallback } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type TimePeriod = "1W" | "1M" | "1Y" | "ALL";

interface ChartDataPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
}

interface YieldChartSectionProps {
  chartData: ChartDataPoint[];
  isLoading: boolean;
  windowWidth: number;
  currentFees?: number;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
}

// Hover state for chart values
interface HoverData {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_HEIGHT_PX = 380;

const CHART_COLORS = {
  apr: "#e85102", // Alphix orange for APR (matches Fee chart)
};

// Dot pattern for chart background
const DOT_PATTERN = {
  color: "#333333",
  size: "1px",
  spacing: "24px",
};

// Axis dimensions
const TIME_SCALE_HEIGHT = 26;
const PRICE_SCALE_WIDTH = 55;
const CHART_DATA_PADDING = 10;

// Chart config for Recharts
const chartConfig: ChartConfig = {
  apr: { label: "APR", color: CHART_COLORS.apr },
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatApr(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K%`;
  if (value >= 100) return `${value.toFixed(0)}%`;
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

function formatAprAxis(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const absValue = Math.abs(value);
  if (absValue >= 100) return `${value.toFixed(0)}%`;
  if (absValue >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Time period selector
 */
interface TimePeriodSelectorProps {
  period: TimePeriod;
  onPeriodChange: (period: TimePeriod) => void;
  disabled?: boolean;
}

const TimePeriodSelector = memo(function TimePeriodSelector({
  period,
  onPeriodChange,
  disabled,
}: TimePeriodSelectorProps) {
  const options: TimePeriod[] = ["1W", "1M", "1Y", "ALL"];

  return (
    <div
      className={cn(
        "flex flex-row items-center gap-1",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {options.map((opt) => {
        const isSelected = period === opt;

        return (
          <button
            key={opt}
            onClick={() => onPeriodChange(opt)}
            disabled={disabled}
            className={cn(
              "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
              isSelected
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
});

/**
 * Pulsating dot for the last data point
 */
interface LastPointDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  dataLength: number;
  color: string;
  isHovering: boolean;
}

// Background color for the dot border (matches Fee chart)
const SURFACE1_COLOR = "hsl(0 0% 7%)";

function LastPointPulsatingDot({
  cx,
  cy,
  index,
  dataLength,
  color,
  isHovering,
}: LastPointDotProps) {
  if (
    index !== dataLength - 1 ||
    isHovering ||
    cx === undefined ||
    cy === undefined
  ) {
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
function DeltaDisplay({ delta }: { delta: number }) {
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

// ============================================================================
// Main Component
// ============================================================================

export const YieldChartSection = memo(function YieldChartSection({
  chartData,
  isLoading,
  windowWidth,
  currentFees,
  timePeriod,
  onTimePeriodChange,
}: YieldChartSectionProps) {
  const [hoverData, setHoverData] = useState<HoverData | null>(null);

  // Handle mouse events
  const handleMouseMove = useCallback(
    (data: { activePayload?: Array<{ payload: ChartDataPoint }> }) => {
      if (data.activePayload && data.activePayload.length > 0) {
        const point = data.activePayload[0].payload;
        setHoverData({
          timestamp: point.timestamp,
          feesUsd: point.feesUsd,
          accumulatedFeesUsd: point.accumulatedFeesUsd,
          apr: point.apr,
        });
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // Calculate domain and values
  const { aprDomain, latestValues, aprDelta } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        aprDomain: [0, 100] as [number, number],
        latestValues: {
          feesUsd: currentFees ?? 0,
          accumulatedFeesUsd: 0,
          apr: 0,
        },
        aprDelta: 0,
      };
    }

    // Calculate APR domain
    const aprs = chartData.map((d) => d.apr).filter((a) => a >= 0);
    const minApr = aprs.length > 0 ? Math.min(...aprs) : 0;
    const maxApr = aprs.length > 0 ? Math.max(...aprs) : 100;
    const aprPadding = (maxApr - minApr) * 0.1 || maxApr * 0.1 || 10;

    // Get latest values
    const latest = chartData[chartData.length - 1];
    const first = chartData[0];

    // Calculate delta from first to latest
    const aprDelta = first.apr !== 0 ? ((latest.apr - first.apr) / first.apr) * 100 : 0;

    return {
      aprDomain: [
        Math.max(0, minApr - aprPadding),
        maxApr + aprPadding,
      ] as [number, number],
      latestValues: {
        feesUsd: latest.feesUsd,
        accumulatedFeesUsd: latest.accumulatedFeesUsd,
        apr: latest.apr,
      },
      aprDelta,
    };
  }, [chartData, currentFees]);

  // Display values (hover or current)
  const displayValues = hoverData ?? latestValues;
  const isHovering = hoverData !== null;

  // Dot pattern background
  const dotPattern = `radial-gradient(circle, ${DOT_PATTERN.color} ${DOT_PATTERN.size}, transparent ${DOT_PATTERN.size})`;

  // No data state - show structure with current values (even if 0)
  const hasNoData = !isLoading && chartData.length === 0;

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="relative" style={{ height: CHART_HEIGHT_PX }}>
          <div
            className="absolute pointer-events-none"
            style={{
              top: 0,
              left: 0,
              right: PRICE_SCALE_WIDTH,
              bottom: TIME_SCALE_HEIGHT,
              backgroundImage: dotPattern,
              backgroundSize: `${DOT_PATTERN.spacing} ${DOT_PATTERN.spacing}`,
            }}
          />
          <div className="flex flex-row absolute w-full gap-2 items-start z-10">
            <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
              <div className="h-9 w-20 bg-muted/20 animate-pulse rounded" />
              <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
            </div>
          </div>
        </div>
        <TimePeriodSelector
          period={timePeriod}
          onPeriodChange={onTimePeriodChange}
          disabled
        />
      </div>
    );
  }

  const dataLength = chartData.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Chart area with pattern overlay and header callout */}
      <div className="relative" style={{ height: CHART_HEIGHT_PX }}>
        {/* Pattern overlay - positioned to avoid axis */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            right: PRICE_SCALE_WIDTH,
            bottom: TIME_SCALE_HEIGHT,
            backgroundImage: dotPattern,
            backgroundSize: `${DOT_PATTERN.spacing} ${DOT_PATTERN.spacing}`,
            backgroundPosition: "0 0",
            zIndex: 0,
          }}
        />

        {/* Chart header callout (matches ChartHeader.tsx pattern) */}
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <span className="text-3xl font-semibold text-foreground tabular-nums truncate">
              {formatApr(displayValues.apr)}
            </span>
            <div className="flex flex-row gap-2 truncate items-center text-xs">
              {isHovering ? (
                <>
                  <span className="text-muted-foreground">
                    Unclaimed: <span className="text-foreground tabular-nums">{formatUsd(displayValues.feesUsd)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Total: <span className="text-foreground tabular-nums">{formatUsd(displayValues.accumulatedFeesUsd)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(hoverData.timestamp)}
                  </span>
                </>
              ) : (
                <DeltaDisplay delta={aprDelta} />
              )}
            </div>
          </div>
        </div>

        {/* Empty state message when no historical data */}
        {hasNoData && (
          <div className="absolute inset-0 flex items-center justify-center z-5">
            <span className="text-muted-foreground/60 text-xs">No data available</span>
          </div>
        )}

        {/* Chart - single Y-axis on right */}
        <ChartContainer config={chartConfig} className="w-full h-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 96, right: 0, bottom: 0, left: 0 }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <CartesianGrid
                horizontal
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--sidebar-border) / 0.2)"
              />
              <XAxis
                dataKey="timestamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatDate}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                minTickGap={40}
                padding={{ left: 0, right: CHART_DATA_PADDING }}
              />

              {/* Single Y-axis on right for APR */}
              <YAxis
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={PRICE_SCALE_WIDTH}
                tickFormatter={formatAprAxis}
                domain={aprDomain}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />

              <ChartTooltip
                cursor={{
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
                content={() => null}
              />

              {/* APR line with pulsating dot */}
              <Line
                type="monotone"
                dataKey="apr"
                strokeWidth={2}
                stroke={CHART_COLORS.apr}
                isAnimationActive={false}
                dot={(props) => (
                  <LastPointPulsatingDot
                    {...props}
                    dataLength={dataLength}
                    color={CHART_COLORS.apr}
                    isHovering={isHovering}
                  />
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Time period selector at bottom (no legend) */}
      <TimePeriodSelector
        period={timePeriod}
        onPeriodChange={onTimePeriodChange}
      />
    </div>
  );
});

export default YieldChartSection;
