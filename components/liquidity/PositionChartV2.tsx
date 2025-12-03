"use client";

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  UTCTimestamp,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  DataChangedScope,
  SeriesOptionsMap,
  Coordinate,
} from 'lightweight-charts';
import { usePoolChartData } from '@/hooks/usePoolChartData';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { ArrowLeftRight } from 'lucide-react';

interface PositionChartV2Props {
  token0: string;
  token1: string;
  denominationBase: string; // Inherited from parent - the initial base token
  currentPrice?: string | null; // Already in display denomination from parent
  currentPoolTick?: number | null;
  minPrice?: string; // Already in display denomination from parent
  maxPrice?: string; // Already in display denomination from parent
  isInRange?: boolean;
  isFullRange?: boolean;
  selectedPoolId: string;
  className?: string;
  chartKey?: number;
}

interface PriceDataPoint {
  time: UTCTimestamp;
  value: number;
}

const CHART_HEIGHT = 220;

// ===== Range Band Primitive (based on Uniswap's BandsIndicator) =====

interface BandData {
  time: Time;
  upper: number;
  lower: number;
}

interface BandRendererData {
  x: Coordinate | number;
  upper: Coordinate | number;
  lower: Coordinate | number;
}

interface BandViewData {
  data: BandRendererData[];
  fillColor: string;
  lineColor: string;
}

class RangeBandRenderer implements ISeriesPrimitivePaneRenderer {
  private _viewData: BandViewData;

  constructor(data: BandViewData) {
    this._viewData = data;
  }

  draw() {
    // Main pane drawing (we use drawBackground instead)
  }

  drawBackground(target: any) {
    const points = this._viewData.data;
    if (points.length === 0) return;

    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);

      // Create filled region between upper and lower bounds
      const region = new Path2D();
      const lines = new Path2D();

      // Draw upper line
      region.moveTo(points[0]?.x, points[0]?.upper);
      lines.moveTo(points[0]?.x, points[0]?.upper);
      for (const point of points) {
        region.lineTo(point.x, point.upper);
        lines.lineTo(point.x, point.upper);
      }

      // Connect to lower line
      const end = points.length - 1;
      region.lineTo(points[end]?.x, points[end]?.lower);
      lines.moveTo(points[end]?.x, points[end]?.lower);

      // Draw lower line back
      for (let i = points.length - 1; i >= 0; i--) {
        region.lineTo(points[i]?.x, points[i]?.lower);
        lines.lineTo(points[i]?.x, points[i]?.lower);
      }

      // Close the region
      region.lineTo(points[0]?.x, points[0]?.upper);
      region.closePath();

      // Fill and stroke
      ctx.fillStyle = this._viewData.fillColor;
      ctx.fill(region);
      ctx.strokeStyle = this._viewData.lineColor;
      ctx.lineWidth = 1;
      ctx.stroke(lines);
    });
  }
}

class RangeBandPaneView implements ISeriesPrimitivePaneView {
  private _source: RangeBandPrimitive;
  private _data: BandViewData;

  constructor(source: RangeBandPrimitive) {
    this._source = source;
    this._data = {
      data: [],
      fillColor: this._source._fillColor,
      lineColor: this._source._lineColor,
    };
  }

  update() {
    const series = this._source.series;
    const timeScale = this._source.chart.timeScale();

    this._data.data = this._source._bandsData.map((d) => {
      return {
        x: timeScale.timeToCoordinate(d.time) ?? -100,
        upper: series.priceToCoordinate(d.upper) ?? -100,
        lower: series.priceToCoordinate(d.lower) ?? -100,
      };
    });
  }

  renderer() {
    return new RangeBandRenderer(this._data);
  }
}

class RangeBandPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | undefined = undefined;
  private _series: ISeriesApi<keyof SeriesOptionsMap> | undefined = undefined;
  private _requestUpdate?: () => void;
  private _paneViews: RangeBandPaneView[];

  _bandsData: BandData[] = [];
  _fillColor: string;
  _lineColor: string;
  private _minPrice: number;
  private _maxPrice: number;

  constructor(minPrice: number, maxPrice: number, fillColor: string, lineColor: string) {
    this._minPrice = minPrice;
    this._maxPrice = maxPrice;
    this._fillColor = fillColor;
    this._lineColor = lineColor;
    this._paneViews = [new RangeBandPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._series.subscribeDataChanged(this._onDataChanged);
    this.dataUpdated('full');
  }

  detached() {
    this._series?.unsubscribeDataChanged(this._onDataChanged);
    this._chart = undefined;
    this._series = undefined;
    this._requestUpdate = undefined;
  }

  paneViews() {
    return this._paneViews;
  }

  updateAllViews() {
    this._paneViews.forEach((pv) => pv.update());
  }

  get chart(): IChartApi {
    if (!this._chart) throw new Error('Chart is undefined');
    return this._chart;
  }

  get series(): ISeriesApi<keyof SeriesOptionsMap> {
    if (!this._series) throw new Error('Series is undefined');
    return this._series;
  }

  private _onDataChanged = (scope: DataChangedScope) => {
    this.dataUpdated(scope);
  };

  private dataUpdated(scope: DataChangedScope) {
    const seriesData = this.series.data();

    // Create band data for each time point
    this._bandsData = seriesData.map((d: any) => ({
      time: d.time,
      upper: this._maxPrice,
      lower: this._minPrice,
    }));

    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }
}

// ===== Main Component =====

export function PositionChartV2({
  token0,
  token1,
  denominationBase: inheritedDenominationBase,
  currentPrice,
  currentPoolTick,
  minPrice,
  maxPrice,
  isInRange,
  isFullRange,
  selectedPoolId,
  className,
  chartKey = 0,
}: PositionChartV2Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Local denomination state - can be flipped by user in modal
  // Initialize with inherited value from parent
  const [localDenominationBase, setLocalDenominationBase] = useState(inheritedDenominationBase);

  // Reset local denomination when inherited value changes (e.g., switching positions)
  useEffect(() => {
    setLocalDenominationBase(inheritedDenominationBase);
  }, [inheritedDenominationBase]);

  // API returns token1/token0; check if we need to invert based on denomination
  const apiNeedsInvert = inheritedDenominationBase === token1;
  const userFlipped = localDenominationBase !== inheritedDenominationBase;

  // Fetch data with refetch capability
  const {
    data: priceResult,
    isLoading: isPriceLoading,
    error: priceError,
    refetch: refetchPrice
  } = usePoolChartData(token0, token1);

  const rawPriceData = priceResult?.data || [];

  const parsedPrices = useMemo(() => {
    const minNum = minPrice ? parseFloat(minPrice) : null;
    const maxNum = maxPrice ? parseFloat(maxPrice) : null;
    const currentNum = currentPrice ? parseFloat(currentPrice) : null;
    if (userFlipped) {
      return {
        minPriceNum: maxNum ? (1 / maxNum) : null,
        maxPriceNum: minNum ? (1 / minNum) : null,
        currentPriceNum: currentNum ? (1 / currentNum) : null
      };
    }
    return { minPriceNum: minNum, maxPriceNum: maxNum, currentPriceNum: currentNum };
  }, [minPrice, maxPrice, currentPrice, userFlipped]);

  const { minPriceNum, maxPriceNum, currentPriceNum } = parsedPrices;

  const priceData: PriceDataPoint[] = useMemo(() => {
    return rawPriceData.map((point: any) => {
      let price = point.price;
      if (apiNeedsInvert) price = 1 / price;
      if (userFlipped) price = 1 / price;
      return { time: point.timestamp as UTCTimestamp, value: price };
    });
  }, [rawPriceData, apiNeedsInvert, userFlipped]);

  // Initialize and update chart
  useEffect(() => {
    if (!chartContainerRef.current || priceData.length === 0) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      autoSize: true,
      height: CHART_HEIGHT,
      handleScroll: false,
      handleScale: false,
      layout: {
        background: { color: 'transparent' },
        textColor: '#a3a3a3',
      },
      grid: {
        vertLines: { color: '#323232' },
        horzLines: { color: '#323232' },
      },
      localization: {
        priceFormatter: (price: number) => {
          // 6 decimals if under 0.01
          if (price < 0.01) {
            return price.toFixed(6);
          }
          // 4 decimals if under 10
          if (price < 10) {
            return price.toFixed(4);
          }
          // 2 decimals if 10 or over
          return price.toFixed(2);
        },
      },
      rightPriceScale: {
        borderColor: '#323232',
        visible: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#323232',
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: '#4a4a4a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2a2a',
        },
        horzLine: {
          color: '#4a4a4a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2a2a',
        },
      },
    });

    // Create separate data arrays for in-range and out-of-range segments
    // Each point is colored based on its own value
    // We add transition points to both segments for visual continuity
    const inRangeSegments: PriceDataPoint[][] = [];
    const outRangeSegments: PriceDataPoint[][] = [];

    if (isFullRange) {
      // Full Range: entire line is green
      inRangeSegments.push(priceData);
    } else if (minPriceNum === null || maxPriceNum === null) {
      // No range defined, everything is out of range
      outRangeSegments.push(priceData);
    } else {
      let currentInSegment: PriceDataPoint[] = [];
      let currentOutSegment: PriceDataPoint[] = [];
      let lastWasInRange = false;

      priceData.forEach((point, idx) => {
        const pointInRange = point.value >= minPriceNum && point.value <= maxPriceNum;

        if (idx === 0) {
          // First point
          if (pointInRange) {
            currentInSegment.push(point);
          } else {
            currentOutSegment.push(point);
          }
          lastWasInRange = pointInRange;
        } else {
          if (pointInRange === lastWasInRange) {
            // Continue current segment
            if (pointInRange) {
              currentInSegment.push(point);
            } else {
              currentOutSegment.push(point);
            }
          } else {
            // Transition detected
            // Close the old segment WITH the current transition point
            if (lastWasInRange) {
              currentInSegment.push(point); // Add transition point to end of green
              inRangeSegments.push([...currentInSegment]);
              currentInSegment = [];
              currentOutSegment = [point]; // Start red with transition point
            } else {
              currentOutSegment.push(point); // Add transition point to end of red
              outRangeSegments.push([...currentOutSegment]);
              currentOutSegment = [];
              currentInSegment = [point]; // Start green with transition point
            }
            lastWasInRange = pointInRange;
          }
        }
      });

      // Close any remaining segments
      if (currentInSegment.length > 0) {
        inRangeSegments.push(currentInSegment);
      }
      if (currentOutSegment.length > 0) {
        outRangeSegments.push(currentOutSegment);
      }
    }

    // Create a transparent reference series for the range band that spans all data
    // This ensures the green range shows across the entire chart
    const refSeries = chart.addLineSeries({
      color: 'transparent',
      lineWidth: 1,
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    refSeries.setData(priceData);

    // Attach range band primitive to the reference series (always spans full chart)
    if (minPriceNum !== null && maxPriceNum !== null) {
      const rangeBand = new RangeBandPrimitive(
        minPriceNum,
        maxPriceNum,
        'rgba(34, 197, 94, 0.1)',
        'rgba(34, 197, 94, 0.3)'
      );
      refSeries.attachPrimitive(rangeBand);
    }

    // Add price line series for each out-of-range segment
    outRangeSegments.forEach((segment) => {
      const series = chart.addLineSeries({
        color: '#ef4444',
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(segment);
    });

    // Add price line series for each in-range segment
    let lastInRangeSeries: ISeriesApi<'Line'> | null = null;
    inRangeSegments.forEach((segment, idx) => {
      const series = chart.addLineSeries({
        color: '#22c55e',
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: idx === inRangeSegments.length - 1,
        priceLineVisible: false,
      });
      series.setData(segment);
      lastInRangeSeries = series;
    });

    // Use last in-range series for reference, or the transparent series if no in-range exists
    priceSeriesRef.current = lastInRangeSeries || refSeries;

    // Add min/max price lines (dashed)
    if (minPriceNum !== null && priceSeriesRef.current) {
      priceSeriesRef.current.createPriceLine({
        price: minPriceNum,
        color: 'rgba(34, 197, 94, 0.6)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    if (maxPriceNum !== null && priceSeriesRef.current) {
      priceSeriesRef.current.createPriceLine({
        price: maxPriceNum,
        color: 'rgba(34, 197, 94, 0.6)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    chart.timeScale().fitContent();

    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
    };
  }, [priceData, minPriceNum, maxPriceNum, currentPriceNum, isInRange]);

  const isLoading = isPriceLoading;
  const error = !!priceError;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full w-full", className)}>
        <Image
          src="/LogoIconWhite.svg"
          alt="Loading"
          width={32}
          height={32}
          className="animate-pulse opacity-75"
        />
      </div>
    );
  }

  if (error || priceData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full w-full", className)}>
        <div className="h-full w-full bg-muted/10 rounded-lg flex items-center justify-center">
          <span className="text-xs text-muted-foreground">
            {error ? 'Error loading chart' : 'No chart data available'}
          </span>
        </div>
      </div>
    );
  }

  const baseToken = localDenominationBase;
  const quoteToken = localDenominationBase === token0 ? token1 : token0;

  return (
    <div className={cn("relative h-full w-full", className)} style={{ height: CHART_HEIGHT }}>
      {/* Controls */}
      <div className="absolute top-1 left-1 z-20">
        <button
          onClick={() => setLocalDenominationBase(localDenominationBase === token0 ? token1 : token0)}
          className="h-5 flex items-center gap-1 px-1.5 rounded border border-sidebar-border bg-button opacity-80 hover:opacity-100 hover:brightness-110 hover:border-white/30 text-xs transition-opacity"
          title={`Showing ${baseToken} per ${quoteToken}. Click to flip`}
        >
          <ArrowLeftRight className="h-3 w-3" />
          <span className="font-mono">{baseToken}/{quoteToken}</span>
        </button>
      </div>

      <div
        ref={chartContainerRef}
        className="absolute top-0 left-0 right-0 bottom-0"
      />
    </div>
  );
}
