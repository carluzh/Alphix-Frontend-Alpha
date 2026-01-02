"use client";

import { memo, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

// Constants matching Uniswap
const CHART_HEIGHT = 300;
const UNFUNDED_CHART_SKELETON_HEIGHT = 275;

// Chart period options
export enum ChartPeriod {
  HOUR = "1H",
  DAY = "1D",
  WEEK = "1W",
  MONTH = "1M",
  YEAR = "1Y",
}

interface PeriodOption {
  value: ChartPeriod;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: ChartPeriod.DAY, label: "1D" },
  { value: ChartPeriod.WEEK, label: "1W" },
  { value: ChartPeriod.MONTH, label: "1M" },
  { value: ChartPeriod.YEAR, label: "1Y" },
];

interface ChartDataPoint {
  time: number;
  value: number;
}

interface PortfolioChartProps {
  portfolioTotalBalanceUSD?: number;
  isPortfolioZero?: boolean;
  chartData?: ChartDataPoint[];
  isPending?: boolean;
  error?: Error | null;
  selectedPeriod?: ChartPeriod;
  onPeriodChange?: (period: ChartPeriod) => void;
  className?: string;
}

/**
 * Format USD value
 */
function formatUSD(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * PortfolioChart - matches Uniswap's PortfolioChart.tsx styling
 *
 * Layout:
 * - Container: gap="$spacing16", grow, shrink
 * - Chart height: 300px
 * - Period selector: SegmentedControl below chart
 */
export const PortfolioChart = memo(function PortfolioChart({
  portfolioTotalBalanceUSD = 0,
  isPortfolioZero = false,
  chartData = [],
  isPending = false,
  error,
  selectedPeriod = ChartPeriod.DAY,
  onPeriodChange,
  className,
}: PortfolioChartProps) {
  const [localPeriod, setLocalPeriod] = useState(selectedPeriod);
  const activePeriod = onPeriodChange ? selectedPeriod : localPeriod;

  const handlePeriodChange = (period: ChartPeriod) => {
    if (onPeriodChange) {
      onPeriodChange(period);
    } else {
      setLocalPeriod(period);
    }
  };

  // Generate mock data if none provided
  const displayData = useMemo(() => {
    if (chartData.length > 0) return chartData;

    // Generate mock chart data for demo
    const now = Math.floor(Date.now() / 1000);
    const points: ChartDataPoint[] = [];
    const baseValue = portfolioTotalBalanceUSD || 1000;

    for (let i = 0; i < 24; i++) {
      const variance = (Math.random() - 0.5) * baseValue * 0.1;
      points.push({
        time: now - (24 - i) * 3600,
        value: baseValue + variance,
      });
    }
    return points;
  }, [chartData, portfolioTotalBalanceUSD]);

  // Determine chart color based on value change
  const chartColor = useMemo(() => {
    if (displayData.length < 2) return "#22c55e"; // Green default
    const firstValue = displayData[0].value;
    const lastValue = displayData[displayData.length - 1].value;
    if (lastValue > firstValue) return "#22c55e"; // Green
    if (lastValue < firstValue) return "#ef4444"; // Red
    return "#22c55e"; // Green default
  }, [displayData]);

  // Calculate change percentage
  const changeInfo = useMemo(() => {
    if (displayData.length < 2) return null;
    const firstValue = displayData[0].value;
    const lastValue = displayData[displayData.length - 1].value;
    const changeAbsolute = lastValue - firstValue;
    const changePercent = (changeAbsolute / firstValue) * 100;
    return {
      absolute: changeAbsolute,
      percent: changePercent,
      isPositive: changeAbsolute >= 0,
    };
  }, [displayData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    const date = new Date(data.time * 1000);

    return (
      <div className="bg-container border border-sidebar-border rounded-lg shadow-lg p-3 text-xs">
        <div className="text-muted-foreground mb-1">
          {date.toLocaleDateString()}{" "}
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="text-foreground font-medium text-sm">
          {formatUSD(data.value)}
        </div>
      </div>
    );
  };

  // Error state
  if (error) {
    return (
      <div
        className={cn("flex-1 flex items-center justify-center", className)}
        style={{ height: CHART_HEIGHT }}
      >
        <div className="text-red-500 text-sm">Failed to load chart</div>
      </div>
    );
  }

  // Loading state
  if (isPending) {
    return (
      <div
        className={cn(
          "flex-1 bg-muted/30 rounded-xl animate-pulse flex items-center justify-center",
          className
        )}
        style={{ height: CHART_HEIGHT }}
      >
        <div className="text-muted-foreground text-sm">Loading chart...</div>
      </div>
    );
  }

  // Empty portfolio state
  if (isPortfolioZero) {
    return (
      <div className={cn("flex-1 flex flex-col gap-4", className)}>
        <div
          className="relative flex items-center justify-center"
          style={{ height: UNFUNDED_CHART_SKELETON_HEIGHT }}
        >
          <span className="text-4xl font-light text-muted-foreground">
            $0.00
          </span>
          <div className="absolute top-[60%] left-0 right-0 h-[3px] bg-sidebar-border" />
        </div>
        {/* Disabled period selector */}
        <div className="flex gap-1 opacity-50 pointer-events-none">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              className="px-3 py-1.5 text-sm text-muted-foreground rounded-lg"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex-1 flex flex-col gap-4", className)}>
      {/* Chart Container with overlaid header */}
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {/* Chart Header - absolutely positioned on top of chart */}
        <div
          className="absolute top-0 left-0 z-10 flex flex-col gap-1 pb-4 pointer-events-none"
          style={{
            background:
              "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background)) 70%, transparent 100%), linear-gradient(to bottom, hsl(var(--background)) 0%, hsl(var(--background)) 70%, transparent 100%)",
          }}
        >
          <span className="text-2xl font-medium text-foreground">
            {formatUSD(portfolioTotalBalanceUSD)}
          </span>
          {changeInfo && (
            <div className="flex items-center gap-2">
              {/* Delta Arrow */}
              <span
                className={cn(
                  "text-sm",
                  changeInfo.isPositive ? "text-green-500" : "text-red-500"
                )}
              >
                {changeInfo.isPositive ? "▲" : "▼"}
              </span>
              {/* Delta Text */}
              <span
                className={cn(
                  "text-sm",
                  changeInfo.isPositive ? "text-green-500" : "text-red-500"
                )}
              >
                {formatUSD(Math.abs(changeInfo.absolute))} (
                {changeInfo.isPositive ? "+" : ""}
                {changeInfo.percent.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>

        {/* Chart - fills entire container */}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={displayData}
            margin={{ top: 60, right: 10, left: 10, bottom: 20 }}
          >
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.2} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(value) => {
                const date = new Date(value * 1000);
                return date.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                });
              }}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={2}
              fill="url(#portfolioGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Period Selector - SegmentedControl style */}
      <div className="flex gap-1 bg-container rounded-xl p-1 w-fit">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => handlePeriodChange(option.value)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-lg transition-colors",
              activePeriod === option.value
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
});

export default PortfolioChart;
