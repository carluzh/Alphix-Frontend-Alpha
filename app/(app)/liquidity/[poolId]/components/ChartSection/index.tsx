"use client";

import { memo, useMemo, useState, useCallback } from "react";
import {
  Bar,
  BarChart,
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
import { ChartType, chartConfig, usePDPChartState } from "./hooks";
import type { ChartDataPoint } from "../../hooks";

interface ChartSectionProps {
  chartData: ChartDataPoint[];
  isLoading: boolean;
  windowWidth: number;
}

const PDP_CHART_HEIGHT_PX = 300; // Match PortfolioChart height

// Colors matching page.old.tsx
const CHART_COLORS = {
  activity: "hsl(var(--chart-3))",
  target: "hsl(var(--chart-2))",
  fee: "#e85102",
  bar: "#404040",
};

// Dot pattern for chart background (matches PortfolioChart)
const DOT_PATTERN = {
  color: "#333333",
  size: "1px",
  spacing: "24px",
};

// Axis dimensions for pattern overlay positioning (matches PatternOverlay.tsx)
const TIME_SCALE_HEIGHT = 26; // Height of x-axis labels
const PRICE_SCALE_WIDTH = 55; // Width of y-axis labels
const CHART_DATA_PADDING = 10; // Padding between chart data and Y-axis (via XAxis padding)

// Time period options
type TimePeriod = "1W" | "1M" | "All";

// Hover state for chart values
interface HoverData {
  date: string;
  fee?: number;
  activity?: number;
  target?: number;
  volume?: number;
  tvl?: number;
}

/**
 * Format fee value with proper decimal places
 * 2 decimals if >= 0.3, 3 if >= 0.05, 4 else
 */
function formatFeeValue(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 0.3) return value.toFixed(2);
  if (absValue >= 0.05) return value.toFixed(3);
  return value.toFixed(4);
}

/**
 * Chart section for pool detail page.
 * PortfolioChart-style layout:
 * - Dot grid pattern background
 * - Large callout header (top-left) showing current/hovered value
 * - Chart type tabs at top (Fee/Volume/TVL)
 * - Time period selector at bottom (1W/1M/All)
 */
export const ChartSection = memo(function ChartSection({
  chartData,
  isLoading,
  windowWidth,
}: ChartSectionProps) {
  const { chartType, setChartType } = usePDPChartState();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("1M");
  const [hoverData, setHoverData] = useState<HoverData | null>(null);

  // Filter chart data based on time period
  const filteredChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    const now = new Date();
    let daysBack = 30; // Default 1M

    switch (timePeriod) {
      case "1W":
        daysBack = 7;
        break;
      case "1M":
        daysBack = 30;
        break;
      case "All":
        return chartData; // No filtering for All time
    }

    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    return chartData.filter(d => new Date(d.date) >= cutoffDate);
  }, [chartData, timePeriod]);

  // Get current (latest) values and daily change from the data
  const currentValues = useMemo(() => {
    if (filteredChartData.length === 0) return null;
    const latest = filteredChartData[filteredChartData.length - 1];
    // Get previous day for daily change calculation
    const previous = filteredChartData.length >= 2
      ? filteredChartData[filteredChartData.length - 2]
      : latest;

    const currentFee = latest.dynamicFee ?? 0;
    const previousFee = previous.dynamicFee ?? 0;

    // Calculate daily change (difference from previous day)
    const feeDailyChange = currentFee - previousFee;
    // Calculate percentage change from previous day
    const feeDailyDelta = previousFee !== 0 ? ((currentFee / previousFee) - 1) * 100 : 0;

    return {
      fee: currentFee,
      feeDailyChange, // Change from previous day
      feeDailyDelta,  // Percentage change from previous day
      activity: latest.volumeTvlRatio ?? 0,
      target: latest.emaRatio ?? 0,
      volume: latest.volumeUSD ?? 0,
      tvl: latest.tvlUSD ?? 0,
      volumeDelta: previous.volumeUSD ? ((latest.volumeUSD ?? 0) / previous.volumeUSD - 1) * 100 : 0,
      tvlDelta: previous.tvlUSD ? ((latest.tvlUSD ?? 0) / previous.tvlUSD - 1) * 100 : 0,
    };
  }, [filteredChartData]);

  // Handle mouse move on chart
  const handleMouseMove = useCallback((data: { activePayload?: Array<{ payload: ChartDataPoint }> }) => {
    if (data.activePayload && data.activePayload.length > 0) {
      const point = data.activePayload[0].payload;
      setHoverData({
        date: point.date,
        fee: point.dynamicFee,
        activity: point.volumeTvlRatio,
        target: point.emaRatio,
        volume: point.volumeUSD,
        tvl: point.tvlUSD,
      });
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverData(null);
  }, []);

  // Get display values (hover or current)
  const displayValues = hoverData ?? (currentValues ? {
    date: filteredChartData[filteredChartData.length - 1]?.date ?? "",
    fee: currentValues.fee,
    activity: currentValues.activity,
    target: currentValues.target,
    volume: currentValues.volume,
    tvl: currentValues.tvl,
  } : null);

  // Format date for X axis
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Format USD for tooltips
  const formatUSD = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "$0.00";
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(2)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  // Calculate domains for dual y-axis Fee chart
  const { ratioDomain, feeDomain } = useMemo(() => {
    if (filteredChartData.length === 0) {
      return { ratioDomain: [0, 1] as [number, number], feeDomain: [0, 1] as [number, number] };
    }

    const ratios = filteredChartData.flatMap((d) => [d.volumeTvlRatio ?? 0, d.emaRatio ?? 0]).filter(Boolean);
    const fees = filteredChartData.map((d) => d.dynamicFee ?? 0).filter(Boolean);

    const ratioMin = ratios.length > 0 ? Math.min(...ratios) : 0;
    const ratioMax = ratios.length > 0 ? Math.max(...ratios) : 1;
    const feeMin = fees.length > 0 ? Math.min(...fees) : 0;
    const feeMax = fees.length > 0 ? Math.max(...fees) : 1;

    const ratioPadding = (ratioMax - ratioMin) * 0.1 || 0.1;
    const feePadding = (feeMax - feeMin) * 0.1 || 0.01;

    return {
      ratioDomain: [Math.max(0, ratioMin - ratioPadding), ratioMax + ratioPadding] as [number, number],
      feeDomain: [Math.max(0, feeMin - feePadding), feeMax + feePadding] as [number, number],
    };
  }, [filteredChartData]);

  // Dot pattern background - positioned to avoid axes (like PatternOverlay.tsx)
  const dotPattern = `radial-gradient(circle, ${DOT_PATTERN.color} ${DOT_PATTERN.size}, transparent ${DOT_PATTERN.size})`;

  // Loading skeleton
  if (isLoading || chartData.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <ChartTypeTabs chartType={chartType} onChartTypeChange={setChartType} disabled />
        <div className="relative" style={{ height: PDP_CHART_HEIGHT_PX }}>
          {/* Pattern overlay - avoid axes */}
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
          {/* Header skeleton */}
          <div className="flex flex-row absolute w-full gap-2 items-start z-10">
            <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
              <div className="h-9 w-20 bg-muted/20 animate-pulse rounded" />
              <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
            </div>
          </div>
        </div>
        <TimePeriodSelector period={timePeriod} onPeriodChange={setTimePeriod} disabled />
      </div>
    );
  }

  // Render Fee chart with dual y-axis (Activity, Target, Fee lines)
  const renderFeeChart = () => {
    const dataLength = filteredChartData.length;
    const isHovering = hoverData !== null;

    return (
      <ChartContainer config={chartConfig as ChartConfig} className="w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={filteredChartData}
            margin={{ top: 96, right: 0, bottom: 0, left: 0 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <CartesianGrid horizontal vertical={false} strokeDasharray="3 3" stroke="hsl(var(--sidebar-border) / 0.2)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatDate}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              minTickGap={40}
              padding={{ left: 0, right: CHART_DATA_PADDING }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={0}
              tickFormatter={(value) => value.toFixed(2)}
              domain={ratioDomain}
              tick={false}
              hide
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={PRICE_SCALE_WIDTH}
              tickFormatter={(value) => `${formatFeeValue(value)}%`}
              domain={feeDomain}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <ChartTooltip
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "4 4" }}
              content={() => null}
            />
            <Line yAxisId="left" type="monotone" dataKey="volumeTvlRatio" strokeWidth={2} dot={false} stroke={CHART_COLORS.activity} isAnimationActive={false} />
            <Line yAxisId="left" type="monotone" dataKey="emaRatio" strokeWidth={2} dot={false} stroke={CHART_COLORS.target} strokeDasharray="5 5" isAnimationActive={false} />
            <Line
              yAxisId="right"
              type="stepAfter"
              dataKey="dynamicFee"
              strokeWidth={2}
              stroke={CHART_COLORS.fee}
              isAnimationActive={false}
              dot={(props) => (
                <LastPointPulsatingDot
                  {...props}
                  dataLength={dataLength}
                  color={CHART_COLORS.fee}
                  isHovering={isHovering}
                />
              )}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    );
  };

  // Render Volume bar chart
  const renderVolumeChart = () => (
    <ChartContainer config={chartConfig as ChartConfig} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={filteredChartData}
          margin={{ top: 96, right: 0, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--sidebar-border) / 0.2)" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={40} padding={{ left: 0, right: CHART_DATA_PADDING }} />
          <YAxis tickFormatter={formatUSD} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={PRICE_SCALE_WIDTH} orientation="right" />
          <ChartTooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            content={() => null}
          />
          <Bar dataKey="volumeUSD" fill={CHART_COLORS.bar} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );

  // Render TVL bar chart
  const renderTVLChart = () => (
    <ChartContainer config={chartConfig as ChartConfig} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={filteredChartData}
          margin={{ top: 96, right: 0, bottom: 0, left: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--sidebar-border) / 0.2)" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={40} padding={{ left: 0, right: CHART_DATA_PADDING }} />
          <YAxis tickFormatter={formatUSD} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={PRICE_SCALE_WIDTH} orientation="right" />
          <ChartTooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            content={() => null}
          />
          <Bar dataKey="tvlUSD" fill={CHART_COLORS.bar} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );

  const renderChart = () => {
    switch (chartType) {
      case ChartType.FEE: return renderFeeChart();
      case ChartType.VOLUME: return renderVolumeChart();
      case ChartType.TVL: return renderTVLChart();
      default: return renderFeeChart();
    }
  };

  // Get the main display value based on chart type
  const getMainDisplayValue = () => {
    if (!displayValues) return { value: "—", label: "", delta: 0 };

    switch (chartType) {
      case ChartType.FEE:
        return {
          value: displayValues.fee != null ? `${formatFeeValue(displayValues.fee)}%` : "—",
          label: "Dynamic Fee",
          delta: currentValues?.feeDailyDelta ?? 0,
        };
      case ChartType.VOLUME:
        return {
          value: formatUSD(displayValues.volume ?? 0),
          label: "Volume",
          delta: currentValues?.volumeDelta ?? 0,
        };
      case ChartType.TVL:
        return {
          value: formatUSD(displayValues.tvl ?? 0),
          label: "TVL",
          delta: currentValues?.tvlDelta ?? 0,
        };
      default:
        return { value: "—", label: "", delta: 0 };
    }
  };

  const mainDisplay = getMainDisplayValue();
  const isHovering = hoverData !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Chart type tabs at top */}
      <ChartTypeTabs chartType={chartType} onChartTypeChange={setChartType} />

      {/* Chart area with pattern overlay and header callout */}
      <div className="relative" style={{ height: PDP_CHART_HEIGHT_PX }}>
        {/* Pattern overlay - positioned to avoid axes (like PatternOverlay.tsx) */}
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
              {mainDisplay.value}
            </span>
            <div className="flex flex-row gap-2 truncate items-center text-xs">
              {/* Fee chart: show delta by default, Target/Activity on hover */}
              {chartType === ChartType.FEE && (
                isHovering && displayValues ? (
                  <>
                    <span className="text-muted-foreground">
                      Target: <span className="text-foreground tabular-nums">{formatFeeValue(displayValues.target ?? 0)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Activity: <span className="text-foreground tabular-nums">{formatFeeValue(displayValues.activity ?? 0)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(hoverData.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </>
                ) : currentValues && (
                  <FeeChangeDisplay change={currentValues.feeDailyChange} delta={currentValues.feeDailyDelta} />
                )
              )}
              {/* Volume/TVL: show delta by default, date on hover */}
              {(chartType === ChartType.VOLUME || chartType === ChartType.TVL) && (
                isHovering ? (
                  <span className="text-muted-foreground">
                    {new Date(hoverData.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                ) : (
                  <DeltaDisplay delta={mainDisplay.delta} />
                )
              )}
            </div>
          </div>
        </div>

        {/* Chart */}
        {renderChart()}
      </div>

      {/* Time period selector at bottom */}
      <TimePeriodSelector period={timePeriod} onPeriodChange={setTimePeriod} />
    </div>
  );
});

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

// Background color for the dot border (matches LiveDotRenderer)
const SURFACE1_COLOR = "hsl(0 0% 7%)";

function LastPointPulsatingDot({ cx, cy, index, dataLength, color, isHovering }: CustomDotProps) {
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

/**
 * Fee change display - shows daily change and percentage
 * Format: ↑ +0.05% (15.00%)
 */
function FeeChangeDisplay({ change, delta }: { change: number; delta: number }) {
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

/**
 * Chart type tabs - simple tab buttons (Fee/Volume/TVL)
 */
interface ChartTypeTabsProps {
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  disabled?: boolean;
}

const ChartTypeTabs = memo(function ChartTypeTabs({ chartType, onChartTypeChange, disabled }: ChartTypeTabsProps) {
  const tabs = [
    { type: ChartType.FEE, label: "Fee" },
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
}

const TimePeriodSelector = memo(function TimePeriodSelector({ period, onPeriodChange, disabled }: TimePeriodSelectorProps) {
  const options: TimePeriod[] = ["1W", "1M", "All"];

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

export default ChartSection;
