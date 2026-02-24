"use client";

import { memo, useMemo, useState, useCallback } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { DeltaArrow } from "@/app/(app)/overview/components/Charts/Delta";

// ============================================================================
// Types
// ============================================================================

export type TimePeriod = "1D" | "1W" | "1M" | "1Y";

// Accept any data with time and value properties
interface ChartDataPoint {
  time: number;
  value: number;
}

interface PriceChartSectionProps {
  chartData: ChartDataPoint[];
  isLoading: boolean;
  windowWidth: number;
  currentPrice?: number;
  minRangePrice?: number;
  maxRangePrice?: number;
  priceInverted: boolean;
  token0Symbol: string;
  token1Symbol: string;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_HEIGHT_PX = 380;

const CHART_COLORS = {
  priceLine: "#f45502", // Alphix orange - primary color for price line
  rangeArea: "rgba(255, 255, 255, 0.03)", // Subtle range fill
  rangeLine: "rgba(255, 255, 255, 0.35)", // Dashed boundary lines
};

// Dot pattern for chart background
const DOT_PATTERN = {
  color: "#333333",
  size: "1px",
  spacing: "24px",
};

// Axis dimensions
const TIME_SCALE_HEIGHT = 26;
const PRICE_SCALE_WIDTH = 70;
const CHART_DATA_PADDING = 10;

// Chart config for Recharts
const chartConfig: ChartConfig = {
  price: { label: "Price", color: CHART_COLORS.priceLine },
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatPrice(value: number, isStablePair = false): string {
  if (!Number.isFinite(value)) return "0";
  // For stablecoin pairs near 1.0, show more decimals
  if (isStablePair && value >= 0.9 && value <= 1.1) {
    return value.toFixed(6);
  }
  if (value >= 10000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1000) return value.toFixed(1);
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.0001) return value.toFixed(6);
  return value.toFixed(8);
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Time period selector with ghost effect for non-1M options
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
  const options: TimePeriod[] = ["1W", "1M", "1Y"];

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

const SURFACE_COLOR = "hsl(0 0% 7%)";

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
      <style>
        {`
          @keyframes price-dot-pulse {
            0% { transform: scale(1); opacity: 0.5; }
            75% { transform: scale(3); opacity: 0; }
            100% { transform: scale(3); opacity: 0; }
          }
        `}
      </style>
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: "price-dot-pulse 2s ease-in-out infinite",
        }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: "price-dot-pulse 2s ease-in-out infinite 0.5s",
        }}
      />
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        stroke={SURFACE_COLOR}
        strokeWidth={2}
      />
    </g>
  );
}

/**
 * Delta display component - matches PortfolioChart style
 * Uses shared DeltaArrow from Delta.tsx
 */
function DeltaDisplay({ priceChange, absoluteChange }: { priceChange: number; absoluteChange: number }) {
  if (!Number.isFinite(priceChange)) return null;

  const colorClass = priceChange === 0 ? "text-muted-foreground" : priceChange >= 0 ? "text-green-500" : "text-red-500";

  // Format absolute change
  const formattedAbsolute = Math.abs(absoluteChange).toFixed(6);
  const formattedPercent = `${Math.abs(priceChange).toFixed(2)}%`;

  return (
    <span className={cn("flex items-center gap-1 tabular-nums text-sm", colorClass)}>
      <DeltaArrow delta={priceChange} size={14} />
      <span>{formattedAbsolute} ({formattedPercent})</span>
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export const PriceChartSection = memo(function PriceChartSection({
  chartData,
  isLoading,
  windowWidth,
  currentPrice,
  minRangePrice,
  maxRangePrice,
  priceInverted,
  token0Symbol,
  token1Symbol,
  timePeriod,
  onTimePeriodChange,
}: PriceChartSectionProps) {
  const [hoverData, setHoverData] = useState<{
    time: number;
    value: number;
  } | null>(null);

  // Handle mouse events
  const handleMouseMove = useCallback(
    (data: { activePayload?: Array<{ payload: ChartDataPoint }> }) => {
      if (data.activePayload && data.activePayload.length > 0) {
        const point = data.activePayload[0].payload;
        setHoverData({ time: point.time, value: point.value });
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // Detect if it's a stablecoin pair (both symbols contain USD or stable naming)
  const isStablePair = useMemo(() => {
    const stableTokens = ["USDC", "USDS", "DAI", "BUSD", "FRAX", "LUSD"];
    const t0 = token0Symbol.toUpperCase();
    const t1 = token1Symbol.toUpperCase();
    return stableTokens.some(s => t0.includes(s)) && stableTokens.some(s => t1.includes(s));
  }, [token0Symbol, token1Symbol]);

  // Calculate price domain and delta
  // Viewport is ±20% around the price history min/max — range boundaries are drawn
  // as reference lines but do NOT expand the viewport (avoids unusable flat-line charts
  // for Full Range or very wide-ranged positions).
  const { priceDomain, latestPrice, priceChange, absoluteChange } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        priceDomain: [0, 1] as [number, number],
        latestPrice: 0,
        priceChange: 0,
        absoluteChange: 0,
      };
    }

    const prices = chartData.map((d) => d.value).filter(Boolean);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    const padding = (maxPrice - minPrice) * 0.2 || maxPrice * 0.2;

    const latest = chartData[chartData.length - 1]?.value ?? 0;
    const first = chartData[0]?.value ?? latest;
    const change = first !== 0 ? ((latest - first) / first) * 100 : 0;
    const absChange = latest - first;

    return {
      priceDomain: [
        Math.max(0, minPrice - padding),
        maxPrice + padding,
      ] as [number, number],
      latestPrice: latest,
      priceChange: change,
      absoluteChange: absChange,
    };
  }, [chartData]);

  // Display values (hover or current)
  const displayValue = hoverData?.value ?? latestPrice;
  const displayTime = hoverData?.time ?? chartData[chartData.length - 1]?.time;
  const isHovering = hoverData !== null;

  // Y-axis formatter function
  const yAxisFormatter = useCallback((value: number) => formatPrice(value, isStablePair), [isStablePair]);


  // Dot pattern background
  const dotPattern = `radial-gradient(circle, ${DOT_PATTERN.color} ${DOT_PATTERN.size}, transparent ${DOT_PATTERN.size})`;

  // Loading skeleton
  if (isLoading || chartData.length === 0) {
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
              <div className="h-9 w-24 bg-muted/20 animate-pulse rounded" />
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
        {/* Pattern overlay */}
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

        {/* Chart header callout */}
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <span className="text-3xl font-semibold text-foreground tabular-nums truncate">
              {formatPrice(displayValue, isStablePair)}
            </span>
            {isHovering && displayTime ? (
              <span className="text-muted-foreground text-sm">
                {formatDateTime(displayTime)}
              </span>
            ) : (
              <DeltaDisplay priceChange={priceChange} absoluteChange={absoluteChange} />
            )}
          </div>
        </div>

        {/* Chart */}
        <ChartContainer config={chartConfig} className="w-full h-full aspect-auto">
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
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatDate}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                minTickGap={40}
                padding={{ left: 0, right: CHART_DATA_PADDING }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={PRICE_SCALE_WIDTH}
                tickFormatter={yAxisFormatter}
                domain={priceDomain}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                orientation="right"
              />

              {/* Range visualization - clamp to viewport so shading is still visible
                  when range boundaries extend beyond the ±20% price history viewport */}
              {minRangePrice !== undefined && maxRangePrice !== undefined && (() => {
                const clampedMin = Math.max(minRangePrice, priceDomain[0]);
                const clampedMax = Math.min(maxRangePrice, priceDomain[1]);
                return clampedMin < clampedMax ? (
                  <ReferenceArea
                    y1={clampedMin}
                    y2={clampedMax}
                    fill={CHART_COLORS.rangeArea}
                    fillOpacity={1}
                    stroke="none"
                  />
                ) : null;
              })()}
              {minRangePrice !== undefined && minRangePrice >= priceDomain[0] && (
                <ReferenceLine
                  y={minRangePrice}
                  stroke={CHART_COLORS.rangeLine}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              {maxRangePrice !== undefined && maxRangePrice <= priceDomain[1] && (
                <ReferenceLine
                  y={maxRangePrice}
                  stroke={CHART_COLORS.rangeLine}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}

              <ChartTooltip
                cursor={{
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }}
                content={() => null}
              />

              <Line
                type="monotone"
                dataKey="value"
                strokeWidth={2}
                stroke={CHART_COLORS.priceLine}
                isAnimationActive={false}
                dot={({ key, ...props }) => (
                  <LastPointPulsatingDot
                    key={key}
                    {...props}
                    dataLength={dataLength}
                    color={CHART_COLORS.priceLine}
                    isHovering={isHovering}
                  />
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Time period selector at bottom */}
      <TimePeriodSelector
        period={timePeriod}
        onPeriodChange={onTimePeriodChange}
      />
    </div>
  );
});

export default PriceChartSection;
