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
import { calculatePeriodRange, formatTickForPeriod } from "@/lib/chart-time-utils";
import { LiveDotRenderer, ChartModelWithLiveDot } from "./LiveDotRenderer";
import { CustomHoverMarker } from "./CustomHoverMarker";
import { ChartHeader } from "./ChartHeader";
import { DeltaArrow, DeltaText, calculateDelta } from "./Delta";
import { TimeFrameSelector } from "./TimeFrameSelector";
import { PatternOverlay } from "./PatternOverlay";
import { ChartSkeleton } from "./ChartSkeleton";
import { type ChartPeriod } from "../../hooks/useOverviewChartData";
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
    return formatTickForPeriod(time as number, period);
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

  updateData(data: ChartDataPoint[]): void { this.data = data; }
}

export function PortfolioChart({ className, currentPositionsValue, isParentLoading }: PortfolioChartProps) {
  const { address, isConnected } = useAccount();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const positionsSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const positionsModelRef = useRef<ChartModelWrapper | null>(null);
  const positionsDataRef = useRef<ChartDataPoint[]>([]);

  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>("DAY");
  const [hoverTime, setHoverTime] = useState<UTCTimestamp | undefined>();
  const [hoverPositionsValue, setHoverPositionsValue] = useState<number | undefined>();
  const [hoverPositionsCoords, setHoverPositionsCoords] = useState<{ x: number; y: number } | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  // Fetch historical position values from backend
  const { data: positionsHistoricalData, isLoading: isLoadingPositions } = usePositionsChartData({
    address,
    period: selectedPeriod,
    currentTotalValue: currentPositionsValue,
    enabled: isConnected && !!address,
  });

  const positionsChartData = useMemo((): ChartDataPoint[] => {
    if (!positionsHistoricalData || positionsHistoricalData.length === 0) return [];
    return positionsHistoricalData.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.value }));
  }, [positionsHistoricalData]);

  const hasPositionsData = positionsChartData.length > 0;
  const latestPositionsValue = hasPositionsData ? positionsChartData[positionsChartData.length - 1].value : 0;

  const showSkeleton = isParentLoading || isLoadingPositions || !isConnected;

  const positionsDataKey = useMemo(() => {
    if (positionsChartData.length === 0) return undefined;
    return JSON.stringify(positionsChartData[positionsChartData.length - 1]);
  }, [positionsChartData]);

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
      timeScale: { borderVisible: false, ticksVisible: false, timeVisible: true, fixLeftEdge: false, fixRightEdge: false },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    // Enforce minimum visible range so tiny movements don't look like huge swings
    const MIN_RANGE_PERCENT = 5;

    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const res = original();
      if (!res) return res;

      const { minValue, maxValue } = res.priceRange;
      const center = (minValue + maxValue) / 2;
      const currentRange = maxValue - minValue;
      const minRange = center * (MIN_RANGE_PERCENT / 100);

      if (currentRange < minRange && center > 0) {
        const halfMinRange = minRange / 2;
        return {
          ...res,
          priceRange: {
            minValue: Math.max(0, center - halfMinRange),
            maxValue: center + halfMinRange,
          },
        };
      }

      return {
        ...res,
        priceRange: {
          minValue: Math.max(0, minValue),
          maxValue: maxValue,
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

    positionsModelRef.current = new ChartModelWrapper(chart, positionsSeries, []);

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.point) {
        const time = param.time as UTCTimestamp;
        setHoverTime(time);

        const xCoord = chart.timeScale().timeToCoordinate(time);
        if (xCoord === null) { setHoverPositionsCoords(null); return; }

        const posValue = interpolateValueAtTime(positionsDataRef.current, time);
        setHoverPositionsValue(posValue);
        if (posValue !== undefined) {
          const y = positionsSeries.priceToCoordinate(posValue);
          setHoverPositionsCoords(y !== null ? { x: xCoord, y } : null);
        } else { setHoverPositionsCoords(null); }
      } else {
        setHoverTime(undefined);
        setHoverPositionsValue(undefined);
        setHoverPositionsCoords(null);
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartContainerRef.current.clientWidth > 0) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    // Use ResizeObserver to handle container resizes (not just window resizes)
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    setIsChartReady(true);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      positionsSeriesRef.current = null;
      positionsModelRef.current = null;
      setIsChartReady(false);
    };
  }, []);

  // Update time scale formatter when period changes
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: { tickMarkFormatter: createTickFormatter(selectedPeriod) },
    });
  }, [selectedPeriod]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (showSkeleton) {
      if (positionsSeriesRef.current) positionsSeriesRef.current.setData([]);
      return;
    }

    // Single data point is rendered as-is (just a dot via LiveDotRenderer)
    // Once a second backend point arrives, we'll have a line
    const dataToRender = positionsChartData;

    positionsDataRef.current = dataToRender;

    if (positionsSeriesRef.current && dataToRender.length > 0) {
      positionsSeriesRef.current.setData(dataToRender);
      positionsModelRef.current?.updateData(dataToRender);

      // Use setVisibleLogicalRange to show full period (setVisibleRange can't show beyond data bounds)
      const [periodFrom, periodTo] = calculatePeriodRange(selectedPeriod);
      const firstDataTime = dataToRender[0].time;
      const lastDataTime = dataToRender[dataToRender.length - 1].time;
      const dataTimeSpan = lastDataTime - firstDataTime;
      const avgBarWidth = dataToRender.length > 1 ? dataTimeSpan / (dataToRender.length - 1) : 3600;

      chartRef.current.timeScale().setVisibleLogicalRange({
        from: (periodFrom - firstDataTime) / avgBarWidth,
        to: (periodTo - firstDataTime) / avgBarWidth,
      });
    } else if (positionsSeriesRef.current) {
      positionsSeriesRef.current.setData([]);
    }
  }, [positionsChartData, showSkeleton, selectedPeriod]);

  // Hide price scale during skeleton loading
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      rightPriceScale: { visible: !showSkeleton },
    });
  }, [showSkeleton]);

  const isHovering = hoverTime !== undefined;
  const displayValue = isHovering ? (hoverPositionsValue ?? 0) : latestPositionsValue;
  const startValue = positionsChartData[0]?.value ?? 0;
  const delta = calculateDelta(startValue, displayValue);
  const dollarChange = displayValue - startValue;

  return (
    <div className={cn("flex flex-col gap-4 flex-1 min-w-0", className)}>
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {!showSkeleton && (
          <ChartHeader
            value={displayValue}
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

        {showSkeleton && (
          <div className="absolute inset-0">
            <ChartSkeleton height={CHART_HEIGHT} />
          </div>
        )}

        {!showSkeleton && isChartReady && !isHovering && hasPositionsData && positionsModelRef.current && chartContainerRef.current && (
          <LiveDotRenderer chartModel={positionsModelRef.current} isHovering={false} chartContainer={chartContainerRef.current} overrideColor={COLORS.positions} dataKey={positionsDataKey} />
        )}
        {isHovering && hoverPositionsCoords && <CustomHoverMarker coordinates={hoverPositionsCoords} lineColor={COLORS.positions} />}
      </div>

      <div className="flex items-center">
        <TimeFrameSelector selectedPeriod={selectedPeriod} onSelectPeriod={setSelectedPeriod} />
      </div>
    </div>
  );
}

export default PortfolioChart;
