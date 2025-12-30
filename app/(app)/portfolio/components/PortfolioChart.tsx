"use client";

import React, { useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import {
  usePortfolioChart,
  formatChartDataForRecharts,
  getPeriodOptions,
  ChartPeriod,
  type PortfolioChartData,
} from "../hooks/usePortfolioChart";

interface PortfolioChartProps {
  currentValue: number;
  className?: string;
}

/**
 * Portfolio value chart component
 * Styled to match the Dynamic Fee Chart from the liquidity page
 *
 * Follows Uniswap's PortfolioChart.tsx pattern but uses Recharts
 */
export function PortfolioChart({ currentValue, className }: PortfolioChartProps) {
  const {
    chartData,
    isLoading,
    error,
    selectedPeriod,
    setSelectedPeriod,
  } = usePortfolioChart(currentValue);

  const formattedData = useMemo(
    () => formatChartDataForRecharts(chartData),
    [chartData]
  );

  const periodOptions = getPeriodOptions();

  // Determine chart color based on change
  const chartColor = useMemo(() => {
    if (!chartData || chartData.changePercent === 0) return "#f45502"; // Brand orange
    return chartData.changePercent > 0 ? "#22c55e" : "#ef4444"; // Green or red
  }, [chartData]);

  // Format change display
  const changeDisplay = useMemo(() => {
    if (!chartData) return null;
    const sign = chartData.changePercent >= 0 ? "+" : "";
    return {
      percent: `${sign}${chartData.changePercent.toFixed(2)}%`,
      absolute: `${sign}${formatUSD(chartData.changeAbsolute)}`,
      isPositive: chartData.changePercent >= 0,
    };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    const date = new Date(data.time * 1000);

    return (
      <div className="bg-container border border-sidebar-border rounded-md shadow-lg p-3 text-xs">
        <div className="text-muted-foreground mb-1">
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="text-foreground font-medium text-sm">
          {formatUSD(data.value)}
        </div>
      </div>
    );
  };

  // Format X-axis tick
  const formatXAxisTick = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    switch (selectedPeriod) {
      case ChartPeriod.HOUR:
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      case ChartPeriod.DAY:
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      case ChartPeriod.WEEK:
        return date.toLocaleDateString([], { weekday: "short" });
      case ChartPeriod.MONTH:
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
      case ChartPeriod.YEAR:
        return date.toLocaleDateString([], { month: "short" });
      default:
        return "";
    }
  };

  if (currentValue <= 0) {
    return (
      <div className={cn("rounded-lg border border-sidebar-border bg-container-secondary p-4", className)}>
        <div className="text-xs text-muted-foreground mb-2">Portfolio Value</div>
        <div className="h-[200px] flex items-center justify-center">
          <div className="text-muted-foreground text-sm">No portfolio data</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-lg border border-sidebar-border bg-container-secondary p-4", className)}>
        <div className="text-xs text-muted-foreground mb-2">Portfolio Value</div>
        <div className="h-[200px] flex items-center justify-center">
          <div className="text-red-500 text-sm">Failed to load chart</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-sidebar-border bg-container-secondary p-4", className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Portfolio Value</div>
          <div className="text-2xl font-medium text-foreground">
            {formatUSD(currentValue)}
          </div>
          {changeDisplay && (
            <div className={cn(
              "text-sm mt-1",
              changeDisplay.isPositive ? "text-green-500" : "text-red-500"
            )}>
              {changeDisplay.percent} ({changeDisplay.absolute})
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex gap-1">
          {periodOptions.map((option) => (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50",
                selectedPeriod === option.value && "bg-muted/50 text-foreground"
              )}
              onClick={() => setSelectedPeriod(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[200px] w-full">
        {isLoading ? (
          <div className="h-full w-full bg-muted/30 rounded animate-pulse flex items-center justify-center">
            <div className="text-muted-foreground text-xs">Loading chart...</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={formattedData}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            >
              <defs>
                <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={formatXAxisTick}
                minTickGap={30}
              />
              <YAxis
                hide
                domain={["dataMin", "dataMax"]}
              />
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
        )}
      </div>

      {/* Info text */}
      <div className="mt-3 text-xs text-muted-foreground">
        <span className="italic">
          Chart shows estimated portfolio value over time.
          {!chartData && " Data may be delayed."}
        </span>
      </div>
    </div>
  );
}

export default PortfolioChart;
