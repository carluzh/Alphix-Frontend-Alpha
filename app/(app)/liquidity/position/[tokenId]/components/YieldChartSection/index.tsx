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
import { DeltaArrow } from "@/app/(app)/overview/components/Charts/Delta";
import {
  calculatePeriodRange,
  generateTicksForPeriod,
  formatTickForPeriod,
  type ChartPeriodPosition,
} from "@/lib/chart-time-utils";

// ============================================================================
// Types
// ============================================================================

export type TimePeriod = "1W" | "1M" | "1Y" | "ALL";

/** Keys for chart series that can be toggled via legend */
type SeriesKey = "apr" | "aaveApy" | "feesUsd" | "accumulatedFeesUsd";

interface ChartDataPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
  /** Aave APY (for rehypo positions) */
  aaveApy?: number;
  /** Combined APR (swap APR + Aave APY) - use this for display */
  totalApr?: number;
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
  aaveApy?: number;
  totalApr: number;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_HEIGHT_PX = 380;

const CHART_COLORS = {
  apr: "#e85102", // Alphix orange for Swap APR
  aaveApy: "#9896FF", // Aave purple for Unified Yield
  feesUsd: "hsl(var(--chart-3))", // Current unclaimed fees
  accumulatedFeesUsd: "hsl(var(--chart-2))", // Total accumulated fees
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
  totalApr: { label: "Total APR", color: CHART_COLORS.apr },
  apr: { label: "Swap APR", color: CHART_COLORS.apr },
  aaveApy: { label: "Unified Yield", color: CHART_COLORS.aaveApy },
  feesUsd: { label: "Unclaimed", color: CHART_COLORS.feesUsd },
  accumulatedFeesUsd: { label: "Total Fees", color: CHART_COLORS.accumulatedFeesUsd },
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
 * Interactive chart legend for toggling series visibility
 */
interface ChartLegendProps {
  visibleSeries: Set<SeriesKey>;
  onToggle: (key: SeriesKey) => void;
  hasAaveData: boolean;
  disabled?: boolean;
}

interface LegendItem {
  key: SeriesKey;
  label: string;
  color: string;
  dashed?: boolean;
}

const ChartLegend = memo(function ChartLegend({
  visibleSeries,
  onToggle,
  hasAaveData,
  disabled,
}: ChartLegendProps) {
  const items: LegendItem[] = useMemo(() => {
    const base: LegendItem[] = [
      { key: "apr", label: "Swap APR", color: CHART_COLORS.apr },
    ];
    if (hasAaveData) {
      base.push({ key: "aaveApy", label: "Unified Yield", color: CHART_COLORS.aaveApy });
    }
    base.push(
      { key: "accumulatedFeesUsd", label: "Total Fees", color: CHART_COLORS.accumulatedFeesUsd, dashed: true },
      { key: "feesUsd", label: "Unclaimed", color: CHART_COLORS.feesUsd }
    );
    return base;
  }, [hasAaveData]);

  return (
    <div
      className={cn(
        "flex flex-row items-center gap-3 flex-wrap",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {items.map(({ key, label, color, dashed }) => {
        const isVisible = visibleSeries.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            disabled={disabled}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-opacity duration-150 cursor-pointer select-none",
              isVisible ? "opacity-100" : "opacity-40"
            )}
          >
            <span
              className="w-3 h-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: dashed ? "transparent" : color,
                borderTop: dashed ? `2px dashed ${color}` : undefined,
              }}
            />
            <span className={cn(isVisible ? "text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
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

/** Delta display with colored arrow - matches PriceChartSection style */
function DeltaDisplay({ delta }: { delta: number }) {
  if (!Number.isFinite(delta)) return null;
  const color = delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-green-500" : "text-red-500";
  return (
    <span className={cn("flex items-center gap-1 tabular-nums text-sm", color)}>
      <DeltaArrow delta={delta} size={14} />
      <span>{Math.abs(delta).toFixed(2)}%</span>
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/** Default visible series on mount */
const DEFAULT_VISIBLE_SERIES: SeriesKey[] = ["apr", "aaveApy", "feesUsd", "accumulatedFeesUsd"];

export const YieldChartSection = memo(function YieldChartSection({
  chartData,
  isLoading,
  windowWidth,
  currentFees,
  timePeriod,
  onTimePeriodChange,
}: YieldChartSectionProps) {
  const [hoverData, setHoverData] = useState<HoverData | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Set<SeriesKey>>(
    () => new Set(DEFAULT_VISIBLE_SERIES)
  );

  // Toggle series visibility (keeps at least one series visible)
  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow hiding all series
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Calculate period range for x-axis domain
  const [periodFrom, periodTo] = useMemo(() => calculatePeriodRange(timePeriod as ChartPeriodPosition), [timePeriod]);

  // Generate ticks for x-axis based on period
  const xAxisTicks = useMemo(() => {
    return generateTicksForPeriod(timePeriod as ChartPeriodPosition, periodFrom, periodTo);
  }, [timePeriod, periodFrom, periodTo]);

  // Format tick based on current period
  const formatTimestamp = useCallback((timestamp: number) => {
    return formatTickForPeriod(timestamp, timePeriod as ChartPeriodPosition);
  }, [timePeriod]);

  // Filter chart data to the selected period and normalize totalApr
  const filteredChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    // Normalize data to ensure totalApr is always defined (fallback to apr)
    const normalizePoint = (d: ChartDataPoint) => ({
      ...d,
      totalApr: d.totalApr ?? d.apr, // Use totalApr if available, otherwise use apr
    });

    // For ALL period, show all data
    if (timePeriod === "ALL") return chartData.map(normalizePoint);
    // Filter data within period range
    return chartData
      .filter(d => d.timestamp >= periodFrom && d.timestamp <= periodTo)
      .map(normalizePoint);
  }, [chartData, timePeriod, periodFrom, periodTo]);

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
          aaveApy: point.aaveApy,
          totalApr: point.totalApr ?? point.apr,
        });
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // Check if data has Aave APY values (for legend display)
  const hasAaveData = useMemo(() => {
    return chartData.some((d) => d.aaveApy !== undefined && d.aaveApy > 0);
  }, [chartData]);

  // Calculate domains and values for dual Y-axis chart
  // Use totalApr (swap + Aave) for display and domain calculations
  // Only include visible series in domain calculations for proper scaling
  const { aprDomain, feeDomain, latestValues, aprDelta } = useMemo(() => {
    if (filteredChartData.length === 0) {
      return {
        aprDomain: [0, 100] as [number, number],
        feeDomain: [0, 1] as [number, number],
        latestValues: {
          feesUsd: currentFees ?? 0,
          accumulatedFeesUsd: 0,
          apr: 0,
          aaveApy: 0,
          totalApr: 0,
        },
        aprDelta: 0,
      };
    }

    // Calculate APR domain using only visible series (for right Y-axis)
    const aprs = filteredChartData.flatMap((d) => {
      const values: number[] = [];
      if (visibleSeries.has("apr")) values.push(d.apr ?? 0);
      if (visibleSeries.has("aaveApy")) values.push(d.aaveApy ?? 0);
      return values;
    }).filter((a) => a >= 0);
    const minApr = aprs.length > 0 ? Math.min(...aprs) : 0;
    const maxApr = aprs.length > 0 ? Math.max(...aprs) : 100;
    const aprPadding = (maxApr - minApr) * 0.1 || maxApr * 0.1 || 10;

    // Calculate fee domain using only visible series (for left Y-axis)
    const fees = filteredChartData.flatMap((d) => {
      const values: number[] = [];
      if (visibleSeries.has("feesUsd")) values.push(d.feesUsd ?? 0);
      if (visibleSeries.has("accumulatedFeesUsd")) values.push(d.accumulatedFeesUsd ?? 0);
      return values;
    }).filter(Boolean);
    const minFee = fees.length > 0 ? Math.min(...fees) : 0;
    const maxFee = fees.length > 0 ? Math.max(...fees) : 1;
    const feePadding = (maxFee - minFee) * 0.1 || maxFee * 0.1 || 0.1;

    // Get latest values
    const latest = filteredChartData[filteredChartData.length - 1];
    const first = filteredChartData[0];

    // Calculate delta from first to latest using totalApr
    const firstTotalApr = first.totalApr ?? first.apr;
    const latestTotalApr = latest.totalApr ?? latest.apr;
    const aprDelta = firstTotalApr !== 0 ? ((latestTotalApr - firstTotalApr) / firstTotalApr) * 100 : 0;

    return {
      aprDomain: [
        Math.max(0, minApr - aprPadding),
        maxApr + aprPadding,
      ] as [number, number],
      feeDomain: [
        Math.max(0, minFee - feePadding),
        maxFee + feePadding,
      ] as [number, number],
      latestValues: {
        feesUsd: latest.feesUsd,
        accumulatedFeesUsd: latest.accumulatedFeesUsd,
        apr: latest.apr,
        aaveApy: latest.aaveApy,
        totalApr: latest.totalApr ?? latest.apr,
      },
      aprDelta,
    };
  }, [filteredChartData, currentFees, visibleSeries]);

  // Display values (hover or current)
  const displayValues = hoverData ?? latestValues;
  const isHovering = hoverData !== null;

  // Display mode: "both" (both APRs), "single" (one APR), "fees" (no APRs)
  const aprVisible = visibleSeries.has("apr");
  const aaveVisible = visibleSeries.has("aaveApy") && hasAaveData;
  const displayMode = aprVisible && aaveVisible ? "both" : aprVisible || aaveVisible ? "single" : "fees";

  // Dot pattern background
  const dotPattern = `radial-gradient(circle, ${DOT_PATTERN.color} ${DOT_PATTERN.size}, transparent ${DOT_PATTERN.size})`;

  // No data state - show structure with current values (even if 0)
  const hasNoData = !isLoading && filteredChartData.length === 0;

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
        <div className="flex flex-row items-center justify-between flex-wrap gap-2">
          <TimePeriodSelector
            period={timePeriod}
            onPeriodChange={onTimePeriodChange}
            disabled
          />
          <ChartLegend
            visibleSeries={visibleSeries}
            onToggle={toggleSeries}
            hasAaveData={hasAaveData}
            disabled
          />
        </div>
      </div>
    );
  }

  const dataLength = filteredChartData.length;

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

        {/* Chart header - dynamic based on visible series */}
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <span className="text-3xl font-semibold text-foreground tabular-nums truncate">
              {displayMode === "fees" ? formatUsd(displayValues.accumulatedFeesUsd)
                : formatApr(displayMode === "both" ? displayValues.totalApr
                  : aprVisible ? displayValues.apr : (displayValues.aaveApy ?? 0))}
            </span>
            <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground">
              {displayMode === "both" ? (
                isHovering ? (
                  <>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: CHART_COLORS.apr }} />{formatApr(displayValues.apr)}</span>
                    <span className="inline-flex items-center gap-1"><span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: CHART_COLORS.aaveApy }} />{formatApr(displayValues.aaveApy ?? 0)}</span>
                    <span>{formatTimestamp(hoverData!.timestamp)}</span>
                  </>
                ) : <DeltaDisplay delta={aprDelta} />
              ) : (
                <>
                  <span>Unclaimed: <span className="text-foreground tabular-nums">{formatUsd(displayValues.feesUsd)}</span></span>
                  {displayMode === "single" && <span>Total: <span className="text-foreground tabular-nums">{formatUsd(displayValues.accumulatedFeesUsd)}</span></span>}
                </>
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
              data={filteredChartData}
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
                type="number"
                domain={[periodFrom, periodTo]}
                ticks={xAxisTicks}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatTimestamp}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                padding={{ left: 0, right: CHART_DATA_PADDING }}
                scale="time"
              />

              {/* Hidden left Y-axis for fee values (USD) */}
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                width={0}
                domain={feeDomain}
                tick={false}
                hide
              />

              {/* Visible right Y-axis for APR (%) */}
              <YAxis
                yAxisId="right"
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

              {/* Accumulated fees line (hidden Y-axis) - dashed line */}
              {visibleSeries.has("accumulatedFeesUsd") && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="accumulatedFeesUsd"
                  strokeWidth={2}
                  stroke={CHART_COLORS.accumulatedFeesUsd}
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              )}

              {/* Current unclaimed fees line (hidden Y-axis) */}
              {visibleSeries.has("feesUsd") && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="feesUsd"
                  strokeWidth={2}
                  stroke={CHART_COLORS.feesUsd}
                  dot={false}
                  isAnimationActive={false}
                />
              )}

              {/* SVG Gradient definitions for Unified Yield line */}
              <defs>
                <linearGradient id="unifiedYieldGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#AAA8FF" />
                  <stop offset="25%" stopColor="#BDBBFF" />
                  <stop offset="50%" stopColor="#9896FF" />
                  <stop offset="75%" stopColor="#BDBBFF" />
                  <stop offset="100%" stopColor="#AAA8FF" />
                </linearGradient>
              </defs>

              {/* Swap APR line - orange (visible Y-axis) */}
              {visibleSeries.has("apr") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="apr"
                  strokeWidth={2}
                  stroke={CHART_COLORS.apr}
                  isAnimationActive={false}
                  dot={({ key, ...props }) => (
                    <LastPointPulsatingDot
                      key={key}
                      {...props}
                      dataLength={dataLength}
                      color={CHART_COLORS.apr}
                      isHovering={isHovering}
                    />
                  )}
                />
              )}

              {/* Unified Yield (Aave APY) line - purple gradient (visible Y-axis) */}
              {visibleSeries.has("aaveApy") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="aaveApy"
                  strokeWidth={2}
                  stroke="url(#unifiedYieldGradient)"
                  isAnimationActive={false}
                  dot={({ key, ...props }) => (
                    <LastPointPulsatingDot
                      key={key}
                      {...props}
                      dataLength={dataLength}
                      color={CHART_COLORS.aaveApy}
                      isHovering={isHovering}
                    />
                  )}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Controls: Time Period Selector and Legend */}
      <div className="flex flex-row items-center justify-between flex-wrap gap-2">
        <TimePeriodSelector
          period={timePeriod}
          onPeriodChange={onTimePeriodChange}
        />
        <ChartLegend
          visibleSeries={visibleSeries}
          onToggle={toggleSeries}
          hasAaveData={hasAaveData}
        />
      </div>
    </div>
  );
});

export default YieldChartSection;
