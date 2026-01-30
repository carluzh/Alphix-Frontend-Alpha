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
type SeriesKey = "totalApr" | "apr" | "currency0Apy" | "currency1Apy" | "feesUsd" | "accumulatedFeesUsd";

interface ChartDataPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
  /** Yield APY for currency0 (e.g., Aave ETH or Spark USDS) */
  currency0Apy?: number;
  /** Yield APY for currency1 (e.g., Aave USDC) */
  currency1Apy?: number;
  /** Combined APR (swap APR + yield sources) - use this for display */
  totalApr?: number;
}

interface YieldChartSectionProps {
  chartData: ChartDataPoint[];
  isLoading: boolean;
  windowWidth: number;
  currentFees?: number;
  timePeriod: TimePeriod;
  onTimePeriodChange: (period: TimePeriod) => void;
  /** If true, this is a Unified Yield position - hide fee-related items */
  isUnifiedYield?: boolean;
  /** Label for currency0 yield line (e.g., "Aave ETH", "Spark USDS") */
  currency0YieldLabel?: string;
  /** Label for currency1 yield line (e.g., "Aave USDC") */
  currency1YieldLabel?: string;
  /** Color for currency0 yield line */
  currency0YieldColor?: string;
  /** Color for currency1 yield line */
  currency1YieldColor?: string;
}

// Hover state for chart values
interface HoverData {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
  currency0Apy?: number;
  currency1Apy?: number;
  totalApr: number;
}

// ============================================================================
// Constants
// ============================================================================

const CHART_HEIGHT_PX = 380;

const CHART_COLORS = {
  totalApr: "#e85102", // Alphix orange for Total APR (main line)
  apr: "#e85102", // Alphix orange for Swap APR (V4 positions)
  aprMuted: "#a0a0a0", // Muted gray for Fees breakdown (UY positions)
  aave: "#9896FF", // Aave purple (default for currency0 yield)
  aaveLighter: "#C4C2FF", // Lighter Aave purple (second Aave token)
  spark: "#F5AC37", // Spark golden yellow (default for currency1 yield)
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
  hasCurrency0Data: boolean;
  hasCurrency1Data: boolean;
  disabled?: boolean;
  /** If true, hide fee-related items (for Unified Yield positions) */
  isUnifiedYield?: boolean;
  /** Label for currency0 yield line */
  currency0Label?: string;
  /** Label for currency1 yield line */
  currency1Label?: string;
  /** Color for currency0 yield line */
  currency0Color?: string;
  /** Color for currency1 yield line */
  currency1Color?: string;
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
  hasCurrency0Data,
  hasCurrency1Data,
  disabled,
  isUnifiedYield = false,
  currency0Label = "Yield (0)",
  currency1Label = "Yield (1)",
  currency0Color = CHART_COLORS.aave,
  currency1Color = CHART_COLORS.spark,
}: ChartLegendProps) {
  const items: LegendItem[] = useMemo(() => {
    const base: LegendItem[] = [];

    if (isUnifiedYield) {
      // For Unified Yield: Unified Yield is solid (main = sum of all), others are dashed (breakdown)
      base.push({ key: "totalApr", label: "Unified Yield", color: CHART_COLORS.totalApr });
      base.push({ key: "apr", label: "Fees", color: CHART_COLORS.aprMuted, dashed: true });
      if (hasCurrency0Data) {
        base.push({ key: "currency0Apy", label: currency0Label, color: currency0Color, dashed: true });
      }
      if (hasCurrency1Data) {
        base.push({ key: "currency1Apy", label: currency1Label, color: currency1Color, dashed: true });
      }
    } else {
      // For V4 positions: show APR and fees
      base.push({ key: "apr", label: "Swap APR", color: CHART_COLORS.apr });
      if (hasCurrency0Data) {
        base.push({ key: "currency0Apy", label: currency0Label, color: currency0Color });
      }
      if (hasCurrency1Data) {
        base.push({ key: "currency1Apy", label: currency1Label, color: currency1Color });
      }
      base.push(
        { key: "accumulatedFeesUsd", label: "Total Fees", color: CHART_COLORS.accumulatedFeesUsd, dashed: true },
        { key: "feesUsd", label: "Unclaimed", color: CHART_COLORS.feesUsd }
      );
    }
    return base;
  }, [hasCurrency0Data, hasCurrency1Data, isUnifiedYield, currency0Label, currency1Label, currency0Color, currency1Color]);

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

/** Default visible series on mount for V4 positions */
const DEFAULT_VISIBLE_SERIES: SeriesKey[] = ["apr", "currency0Apy", "currency1Apy", "feesUsd", "accumulatedFeesUsd"];
/** Default visible series for Unified Yield positions (Total APR + breakdown) */
const DEFAULT_VISIBLE_SERIES_UY: SeriesKey[] = ["totalApr", "apr", "currency0Apy", "currency1Apy"];

export const YieldChartSection = memo(function YieldChartSection({
  chartData,
  isLoading,
  windowWidth,
  currentFees,
  timePeriod,
  onTimePeriodChange,
  isUnifiedYield = false,
  currency0YieldLabel = "Yield (0)",
  currency1YieldLabel = "Yield (1)",
  currency0YieldColor = CHART_COLORS.aave,
  currency1YieldColor = CHART_COLORS.spark,
}: YieldChartSectionProps) {
  const [hoverData, setHoverData] = useState<HoverData | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Set<SeriesKey>>(
    () => new Set(isUnifiedYield ? DEFAULT_VISIBLE_SERIES_UY : DEFAULT_VISIBLE_SERIES)
  );

  // Dynamic chart config based on label/color props
  const chartConfig = useMemo<ChartConfig>(() => ({
    totalApr: { label: "Total APR", color: CHART_COLORS.totalApr },
    apr: { label: "Fees", color: CHART_COLORS.apr },
    currency0Apy: { label: currency0YieldLabel, color: currency0YieldColor },
    currency1Apy: { label: currency1YieldLabel, color: currency1YieldColor },
    feesUsd: { label: "Unclaimed", color: CHART_COLORS.feesUsd },
    accumulatedFeesUsd: { label: "Total Fees", color: CHART_COLORS.accumulatedFeesUsd },
  }), [currency0YieldLabel, currency1YieldLabel, currency0YieldColor, currency1YieldColor]);

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
          currency0Apy: point.currency0Apy,
          currency1Apy: point.currency1Apy,
          totalApr: point.totalApr ?? point.apr,
        });
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // Check if data has per-token yield values (for legend display)
  const hasCurrency0Data = useMemo(() => {
    return chartData.some((d) => d.currency0Apy !== undefined && d.currency0Apy > 0);
  }, [chartData]);

  const hasCurrency1Data = useMemo(() => {
    return chartData.some((d) => d.currency1Apy !== undefined && d.currency1Apy > 0);
  }, [chartData]);

  // Calculate domains and values for dual Y-axis chart
  // Use totalApr (swap + yield sources) for display and domain calculations
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
          currency0Apy: 0,
          currency1Apy: 0,
          totalApr: 0,
        },
        aprDelta: 0,
      };
    }

    // Calculate APR domain using only visible series (for right Y-axis)
    const aprs = filteredChartData.flatMap((d) => {
      const values: number[] = [];
      if (visibleSeries.has("totalApr")) values.push(d.totalApr ?? 0);
      if (visibleSeries.has("apr")) values.push(d.apr ?? 0);
      if (visibleSeries.has("currency0Apy")) values.push(d.currency0Apy ?? 0);
      if (visibleSeries.has("currency1Apy")) values.push(d.currency1Apy ?? 0);
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
    // Use absolute difference (not percentage change) for APR - more meaningful
    const firstTotalApr = first.totalApr ?? first.apr;
    const latestTotalApr = latest.totalApr ?? latest.apr;
    const aprDelta = latestTotalApr - firstTotalApr;

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
        currency0Apy: latest.currency0Apy,
        currency1Apy: latest.currency1Apy,
        totalApr: latest.totalApr ?? latest.apr,
      },
      aprDelta,
    };
  }, [filteredChartData, currentFees, visibleSeries]);

  // Display values (hover or current)
  const displayValues = hoverData ?? latestValues;
  const isHovering = hoverData !== null;

  // Display mode: "multi" (Total APR visible), "single" (one APR), "fees" (no APRs)
  const totalAprVisible = visibleSeries.has("totalApr");
  const aprVisible = visibleSeries.has("apr");
  const c0Visible = visibleSeries.has("currency0Apy") && hasCurrency0Data;
  const c1Visible = visibleSeries.has("currency1Apy") && hasCurrency1Data;
  const visibleAprCount = [totalAprVisible, aprVisible, c0Visible, c1Visible].filter(Boolean).length;
  // If totalApr is visible, always use "multi" mode to show breakdown
  const displayMode = totalAprVisible || visibleAprCount >= 2 ? "multi" : visibleAprCount === 1 ? "single" : "fees";

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
            hasCurrency0Data={hasCurrency0Data}
            hasCurrency1Data={hasCurrency1Data}
            isUnifiedYield={isUnifiedYield}
            currency0Label={currency0YieldLabel}
            currency1Label={currency1YieldLabel}
            currency0Color={currency0YieldColor}
            currency1Color={currency1YieldColor}
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
                : formatApr(displayMode === "multi" ? displayValues.totalApr
                  : aprVisible ? displayValues.apr
                  : c0Visible ? (displayValues.currency0Apy ?? 0)
                  : (displayValues.currency1Apy ?? 0))}
            </span>
            <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground flex-wrap">
              {displayMode === "multi" ? (
                isHovering ? (
                  <>
                    {aprVisible && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: isUnifiedYield ? CHART_COLORS.aprMuted : CHART_COLORS.apr }} />
                        {formatApr(displayValues.apr)}
                      </span>
                    )}
                    {c0Visible && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: currency0YieldColor }} />
                        {formatApr(displayValues.currency0Apy ?? 0)}
                      </span>
                    )}
                    {c1Visible && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: currency1YieldColor }} />
                        {formatApr(displayValues.currency1Apy ?? 0)}
                      </span>
                    )}
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

              {/* SVG Gradient definitions for yield source lines */}
              <defs>
                <linearGradient id="currency0Gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={currency0YieldColor} stopOpacity={0.8} />
                  <stop offset="50%" stopColor={currency0YieldColor} />
                  <stop offset="100%" stopColor={currency0YieldColor} stopOpacity={0.8} />
                </linearGradient>
                <linearGradient id="currency1Gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={currency1YieldColor} stopOpacity={0.8} />
                  <stop offset="50%" stopColor={currency1YieldColor} />
                  <stop offset="100%" stopColor={currency1YieldColor} stopOpacity={0.8} />
                </linearGradient>
              </defs>

              {/* Total APR line - solid orange (main line for UY positions) */}
              {visibleSeries.has("totalApr") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="totalApr"
                  strokeWidth={2.5}
                  stroke={CHART_COLORS.totalApr}
                  isAnimationActive={false}
                  dot={({ key, ...props }) => (
                    <LastPointPulsatingDot
                      key={key}
                      {...props}
                      dataLength={dataLength}
                      color={CHART_COLORS.totalApr}
                      isHovering={isHovering}
                    />
                  )}
                  connectNulls
                />
              )}

              {/* Swap APR / Fees line - orange solid for V4, muted dashed for UY */}
              {visibleSeries.has("apr") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="apr"
                  strokeWidth={isUnifiedYield ? 1.5 : 2}
                  stroke={isUnifiedYield ? CHART_COLORS.aprMuted : CHART_COLORS.apr}
                  strokeDasharray={isUnifiedYield ? "4 4" : undefined}
                  isAnimationActive={false}
                  dot={isUnifiedYield ? false : ({ key, ...props }) => (
                    <LastPointPulsatingDot
                      key={key}
                      {...props}
                      dataLength={dataLength}
                      color={CHART_COLORS.apr}
                      isHovering={isHovering}
                    />
                  )}
                  connectNulls
                />
              )}

              {/* Currency0 Yield APY line - dashed (breakdown) */}
              {visibleSeries.has("currency0Apy") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="currency0Apy"
                  strokeWidth={1.5}
                  stroke={currency0YieldColor}
                  strokeDasharray="4 4"
                  isAnimationActive={false}
                  dot={false}
                  connectNulls
                />
              )}

              {/* Currency1 Yield APY line - dashed (breakdown) */}
              {visibleSeries.has("currency1Apy") && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="currency1Apy"
                  strokeWidth={1.5}
                  stroke={currency1YieldColor}
                  strokeDasharray="4 4"
                  isAnimationActive={false}
                  dot={false}
                  connectNulls
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
          hasCurrency0Data={hasCurrency0Data}
          hasCurrency1Data={hasCurrency1Data}
          isUnifiedYield={isUnifiedYield}
          currency0Label={currency0YieldLabel}
          currency1Label={currency1YieldLabel}
          currency0Color={currency0YieldColor}
          currency1Color={currency1YieldColor}
        />
      </div>
    </div>
  );
});

export default YieldChartSection;
