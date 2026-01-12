"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  UTCTimestamp,
  CrosshairMode,
  LineType,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { LiveDotRenderer, ChartModelWithLiveDot } from "./LiveDotRenderer";
import { CustomHoverMarker } from "./CustomHoverMarker";
import { ChartHeader } from "./ChartHeader";
import { DeltaArrow, DeltaText, calculateDelta } from "./Delta";
import { TimeFrameSelector } from "./TimeFrameSelector";
import { PatternOverlay } from "./PatternOverlay";
import { ChartSkeleton } from "./ChartSkeleton";
import {
  useOverviewChartData,
  type ChartPeriod,
} from "../../hooks/useOverviewChartData";
import { usePositionsChartData } from "../../hooks/usePositionsChartData";

const CHART_HEIGHT = 300;

interface ChartDataPoint {
  time: UTCTimestamp;
  value: number;
}

interface PortfolioChartProps {
  className?: string;
  /** Current total value of all positions (calculated by parent using live data) */
  currentPositionsValue?: number;
  /** Parent loading state - when true, positions data is not yet available */
  isParentLoading?: boolean;
}

const COLORS = {
  neutral2: "#9B9B9B",
  background: "#131313",
  surface3: "#2D2D2D",
  positions: "#f45502",
  balance: "#6b7280",
};

function formatPercent(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

function formatDollarChange(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

function createTickFormatter(period: ChartPeriod) {
  return (time: UTCTimestamp): string => {
    const date = new Date(time * 1000);
    switch (period) {
      case "DAY":
        return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      case "WEEK":
        return date.toLocaleDateString("en-US", { weekday: "short" });
      case "MONTH":
      default:
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  };
}

function opacify(opacity: number, color: string): string {
  const alpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, "0");
  return color.startsWith("#") && color.length === 7 ? color + alpha : color;
}

function interpolateValueAtTime(data: ChartDataPoint[], time: UTCTimestamp): number | undefined {
  if (data.length === 0 || time < data[0].time) return undefined;
  if (time >= data[data.length - 1].time) return data[data.length - 1].value;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].time <= time && data[i + 1].time >= time) {
      const t = (time - data[i].time) / (data[i + 1].time - data[i].time);
      return data[i].value + t * (data[i + 1].value - data[i].value);
    }
  }
  return undefined;
}

class ChartModelWrapper implements ChartModelWithLiveDot {
  constructor(private chartApi: IChartApi, private series: ISeriesApi<"Area">, private data: ChartDataPoint[]) {}

  getLastPointCoordinates(): { x: number; y: number } | null {
    if (this.data.length === 0) return null;
    const last = this.data[this.data.length - 1];
    const x = this.chartApi.timeScale().timeToCoordinate(last.time);
    const y = this.series.priceToCoordinate(last.value);
    return x != null && y != null ? { x: Number(x), y: Number(y) } : null;
  }

  fitContent(): void { this.chartApi.timeScale().fitContent(); }
  updateData(data: ChartDataPoint[]): void { this.data = data; }
}

export function PortfolioChart({ className, currentPositionsValue, isParentLoading }: PortfolioChartProps) {
  const { address, isConnected } = useAccount();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const positionsSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const balanceSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const positionsModelRef = useRef<ChartModelWrapper | null>(null);
  const balanceModelRef = useRef<ChartModelWrapper | null>(null);
  const balanceDataRef = useRef<ChartDataPoint[]>([]);
  const positionsDataRef = useRef<ChartDataPoint[]>([]);

  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>("DAY");
  const [hoverTime, setHoverTime] = useState<UTCTimestamp | undefined>();
  const [hoverPositionsValue, setHoverPositionsValue] = useState<number | undefined>();
  const [hoverBalanceValue, setHoverBalanceValue] = useState<number | undefined>();
  const [hoverPositionsCoords, setHoverPositionsCoords] = useState<{ x: number; y: number } | null>(null);
  const [hoverBalanceCoords, setHoverBalanceCoords] = useState<{ x: number; y: number } | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const [showPositions, setShowPositions] = useState(true);

  const { data: historicalData, isLoading, isError } = useOverviewChartData({
    address,
    period: selectedPeriod,
    enabled: isConnected && !!address,
  });

  // Fetch historical position values from backend
  // Backend returns stored snapshots, frontend adds "live now" point
  const { data: positionsHistoricalData, isLoading: isLoadingPositions } = usePositionsChartData({
    address,
    period: selectedPeriod,
    currentTotalValue: currentPositionsValue,
    enabled: isConnected && !!address,
  });

  const chartData = useMemo((): ChartDataPoint[] => {
    if (!historicalData || historicalData.length === 0) return [];
    return historicalData.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.value }));
  }, [historicalData]);

  const positionsChartData = useMemo((): ChartDataPoint[] => {
    if (!positionsHistoricalData || positionsHistoricalData.length === 0) return [];
    return positionsHistoricalData.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.value }));
  }, [positionsHistoricalData]);

  const hasPositionsData = positionsChartData.length > 0;
  const hasBalanceData = chartData.length > 0;
  const currentBalanceValue = hasBalanceData ? chartData[chartData.length - 1].value : 0;
  const latestPositionsValue = hasPositionsData ? positionsChartData[positionsChartData.length - 1].value : 0;

  // Show loading state until all data sources have finished loading:
  // - Parent loading: positions data not yet available from parent component
  // - Balance loading: balance chart data is loading
  // - Positions loading: positions data is loading
  const showSkeleton = isParentLoading || isLoading || isLoadingPositions;

  // Create stable dataKey based on actual data + visibility state (for dot repositioning on filter)
  const balanceDataKey = useMemo(() => {
    if (chartData.length === 0) return undefined;
    // Include visibility states so dots reposition when filters change
    return `${showBalance}-${showPositions}-${JSON.stringify(chartData[chartData.length - 1])}`;
  }, [chartData, showBalance, showPositions]);

  const positionsDataKey = useMemo(() => {
    if (positionsChartData.length === 0) return undefined;
    return `${showBalance}-${showPositions}-${JSON.stringify(positionsChartData[positionsChartData.length - 1])}`;
  }, [positionsChartData, showBalance, showPositions]);

  // Create chart only once on mount
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: CHART_HEIGHT,
      layout: { background: { color: "transparent" }, textColor: COLORS.neutral2, fontSize: 12, attributionLogo: false },
      localization: { priceFormatter: (p: number) => `$${p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, color: COLORS.surface3, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.32, bottom: 0.15 }, autoScale: true },
      timeScale: { borderVisible: false, ticksVisible: false, timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
      handleScale: false,
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
    });

    chartRef.current = chart;

    // Uniswap pattern: use autoscaleInfoProvider to enforce minimum $0 visible range
    // This prevents negative values from showing without modifying the data
    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const res = original();
      if (!res) return res;
      return {
        ...res,
        priceRange: {
          minValue: Math.max(0, res.priceRange.minValue),
          maxValue: res.priceRange.maxValue,
        },
      };
    };

    const positionsSeries = chart.addAreaSeries({
      lineColor: COLORS.positions, lineWidth: 2, lineType: LineType.Curved,
      topColor: opacify(40, COLORS.positions), bottomColor: "transparent",
      crosshairMarkerRadius: 0, priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider,
    });
    positionsSeriesRef.current = positionsSeries;

    const balanceSeries = chart.addAreaSeries({
      lineColor: COLORS.balance, lineWidth: 2, lineType: LineType.Curved,
      topColor: "transparent", bottomColor: "transparent",
      crosshairMarkerRadius: 0, priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider,
    });
    balanceSeriesRef.current = balanceSeries;

    positionsModelRef.current = new ChartModelWrapper(chart, positionsSeries, []);
    balanceModelRef.current = new ChartModelWrapper(chart, balanceSeries, []);

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.point) {
        const time = param.time as UTCTimestamp;
        setHoverTime(time);

        const xCoord = chart.timeScale().timeToCoordinate(time);
        if (xCoord === null) { setHoverPositionsCoords(null); setHoverBalanceCoords(null); return; }

        const balValue = interpolateValueAtTime(balanceDataRef.current, time);
        setHoverBalanceValue(balValue);
        if (balValue !== undefined) {
          const y = balanceSeries.priceToCoordinate(balValue);
          setHoverBalanceCoords(y !== null ? { x: xCoord, y } : null);
        } else { setHoverBalanceCoords(null); }

        const posValue = interpolateValueAtTime(positionsDataRef.current, time);
        setHoverPositionsValue(posValue);
        if (posValue !== undefined) {
          const y = positionsSeries.priceToCoordinate(posValue);
          setHoverPositionsCoords(y !== null ? { x: xCoord, y } : null);
        } else { setHoverPositionsCoords(null); }
      } else {
        setHoverTime(undefined);
        setHoverPositionsValue(undefined);
        setHoverBalanceValue(undefined);
        setHoverPositionsCoords(null);
        setHoverBalanceCoords(null);
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        chart.timeScale().fitContent();
      }
    };
    window.addEventListener("resize", handleResize);

    setIsChartReady(true);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      positionsSeriesRef.current = null;
      balanceSeriesRef.current = null;
      positionsModelRef.current = null;
      balanceModelRef.current = null;
      setIsChartReady(false);
    };
  }, []); // Only run once on mount

  // Update time scale formatter when period changes
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: { tickMarkFormatter: createTickFormatter(selectedPeriod) },
    });
  }, [selectedPeriod]);

  useEffect(() => {
    if (!chartRef.current) return;

    // Don't set data while skeleton is showing - wait for both sources to finish loading
    // This prevents one line appearing while the other is still loading
    if (showSkeleton) {
      // Clear any existing data while loading
      if (balanceSeriesRef.current) balanceSeriesRef.current.setData([]);
      if (positionsSeriesRef.current) positionsSeriesRef.current.setData([]);
      return;
    }

    balanceDataRef.current = chartData;
    positionsDataRef.current = positionsChartData;

    if (balanceSeriesRef.current) {
      balanceSeriesRef.current.setData(chartData);
      balanceSeriesRef.current.applyOptions({ lineType: chartData.length < 20 ? LineType.WithSteps : LineType.Curved });
      balanceModelRef.current?.updateData(chartData);
    }

    if (positionsSeriesRef.current) {
      positionsSeriesRef.current.setData(positionsChartData);
      positionsModelRef.current?.updateData(positionsChartData);
    }

    chartRef.current.timeScale().fitContent();
  }, [chartData, positionsChartData, showSkeleton]);

  // Toggle series visibility and refit chart
  useEffect(() => {
    if (balanceSeriesRef.current) {
      balanceSeriesRef.current.applyOptions({ visible: showBalance });
    }
    if (positionsSeriesRef.current) {
      positionsSeriesRef.current.applyOptions({ visible: showPositions });
    }
    // Refit chart after visibility change so dots reposition correctly
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [showBalance, showPositions]);

  // Hide price scale (y-axis) during skeleton loading to prevent "sticking"
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      rightPriceScale: { visible: !showSkeleton },
    });
  }, [showSkeleton]);

  // Toggle behavior:
  // - Both visible, click one → hide it
  // - One hidden, click hidden → show it (both visible)
  // - One hidden, click visible → show hidden (both visible)
  const toggleBalance = () => {
    if (!showBalance) {
      // Balance is hidden - show it
      setShowBalance(true);
    } else if (showPositions) {
      // Both visible - hide Balance
      setShowBalance(false);
    } else {
      // Balance visible, Positions hidden - show Positions
      setShowPositions(true);
    }
  };

  const togglePositions = () => {
    if (!showPositions) {
      // Positions is hidden - show it
      setShowPositions(true);
    } else if (showBalance) {
      // Both visible - hide Positions
      setShowPositions(false);
    } else {
      // Positions visible, Balance hidden - show Balance
      setShowBalance(true);
    }
  };

  const isHovering = hoverTime !== undefined;

  // Only include visible series in values (Issue #2)
  const displayPositionsValue = showPositions ? (isHovering ? (hoverPositionsValue ?? 0) : latestPositionsValue) : 0;
  const displayBalanceValue = showBalance ? (isHovering ? (hoverBalanceValue ?? 0) : currentBalanceValue) : 0;
  const displayTotalValue = displayPositionsValue + displayBalanceValue;

  const positionsStartValue = showPositions ? (positionsChartData[0]?.value ?? 0) : 0;
  const balanceStartValue = showBalance ? (chartData[0]?.value ?? 0) : 0;
  const totalStartValue = positionsStartValue + balanceStartValue;
  const delta = calculateDelta(totalStartValue, displayTotalValue);
  const dollarChange = displayTotalValue - totalStartValue;

  return (
    <div className={cn("flex flex-col gap-4 flex-1 min-w-0", className)}>
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {/* Only show header after skeleton is gone - ChartSkeleton has its own header placeholder */}
        {!showSkeleton && (
          <ChartHeader
            value={displayTotalValue}
            time={hoverTime}
            additionalFields={
              <div className="flex items-center gap-1.5">
                <DeltaArrow delta={delta} />
                <DeltaText delta={delta}>{formatDollarChange(dollarChange)} ({formatPercent(delta ?? 0)})</DeltaText>
              </div>
            }
          />
        )}
        <PatternOverlay showPriceScale />
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* Skeleton overlay */}
        {showSkeleton && (
          <div className="absolute inset-0">
            <ChartSkeleton height={CHART_HEIGHT} />
          </div>
        )}

        {/* Live pulsating dots at line ends - only show after skeleton is gone */}
        {!showSkeleton && isChartReady && !isHovering && hasBalanceData && showBalance && balanceModelRef.current && chartContainerRef.current && (
          <LiveDotRenderer chartModel={balanceModelRef.current} isHovering={false} chartContainer={chartContainerRef.current} overrideColor={COLORS.balance} dataKey={balanceDataKey} />
        )}
        {!showSkeleton && isChartReady && !isHovering && hasPositionsData && showPositions && positionsModelRef.current && chartContainerRef.current && (
          <LiveDotRenderer chartModel={positionsModelRef.current} isHovering={false} chartContainer={chartContainerRef.current} overrideColor={COLORS.positions} dataKey={positionsDataKey} />
        )}
        {/* Hover markers */}
        {isHovering && showPositions && hoverPositionsCoords && <CustomHoverMarker coordinates={hoverPositionsCoords} lineColor={COLORS.positions} />}
        {isHovering && showBalance && hoverBalanceCoords && <CustomHoverMarker coordinates={hoverBalanceCoords} lineColor={COLORS.balance} />}
      </div>

      {/* Bottom row: TimeFrame selector + Series toggles */}
      <div className="flex items-center justify-between">
        <TimeFrameSelector selectedPeriod={selectedPeriod} onSelectPeriod={setSelectedPeriod} />

        {!showSkeleton && (hasBalanceData || hasPositionsData) && (
          <div className="flex items-center gap-3 text-xs">
            {hasBalanceData && (
              <button
                onClick={toggleBalance}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: showBalance ? COLORS.balance : "#555" }}
                />
                <span className={showBalance ? "text-muted-foreground" : "text-muted-foreground/50 line-through"}>
                  Balance
                </span>
              </button>
            )}
            {hasPositionsData && (
              <button
                onClick={togglePositions}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: showPositions ? COLORS.positions : "#555" }}
                />
                <span className={showPositions ? "text-muted-foreground" : "text-muted-foreground/50 line-through"}>
                  Positions
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PortfolioChart;
