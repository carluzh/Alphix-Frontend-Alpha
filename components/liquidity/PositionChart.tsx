"use client";

import React, { useMemo, useRef, useEffect } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis, XAxis, ReferenceLine, ReferenceArea, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { usePoolChartData, usePoolLiquidityTicks } from '@/hooks/usePoolChartData';

interface PositionChartProps {
  token0: string;
  token1: string;
  currentPrice?: string | null;
  minPrice?: string;
  maxPrice?: string;
  isInRange?: boolean;
  selectedPoolId: string;
  chainId?: number;
  currentPoolTick?: number;
  tickLower?: number;
  tickUpper?: number;
  className?: string;
}

interface ChartDataPoint {
  timestamp: number;
  price: number;
  formattedTime?: string;
}

interface LiquidityTick {
  tickIdx: string;
  liquidityGross: string;
  liquidityNet: string;
  price0: string;
  price1: string;
}

interface ProcessedLiquidityPoint {
  price: number;
  liquidity: number;
  tick: number;
}

const LIQUIDITY_BAR_WIDTH = 120;
const AXIS_WIDTH = 60;
const CHART_MARGINS = { top: 15, right: LIQUIDITY_BAR_WIDTH + 15, left: AXIS_WIDTH + 5, bottom: 25 };

export function PositionChart({
  token0,
  token1,
  currentPrice,
  minPrice,
  maxPrice,
  isInRange,
  selectedPoolId,
  className
}: PositionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = React.useState(220);

  // Fetch price data with React Query (cached)
  const { data: priceResult, isLoading: isPriceLoading, error: priceError } = usePoolChartData(token0, token1);
  const rawPriceData = priceResult?.data || [];

  // Fetch liquidity data with React Query (cached)
  const liquidityQuery = usePoolLiquidityTicks(selectedPoolId);
  const { data: liquidityResult, isLoading: isLiquidityLoading, isFetching, isError, error: liquidityError } = liquidityQuery;
  const liquidityData = liquidityResult?.ticks || [];

  // Debug liquidity query state
  useEffect(() => {
    console.log('[PositionChart] Liquidity Query State:', {
      selectedPoolId,
      isLoading: isLiquidityLoading,
      isFetching,
      isError,
      error: liquidityError,
      hasData: !!liquidityResult,
      tickCount: liquidityData?.length || 0
    });
  }, [selectedPoolId, isLiquidityLoading, isFetching, isError, liquidityError, liquidityResult, liquidityData?.length]);

  const error = !!priceError;

  // Debug logging
  useEffect(() => {
    console.log('[PositionChart] State:', {
      token0,
      token1,
      selectedPoolId,
      isPriceLoading,
      isLiquidityLoading,
      priceDataLength: rawPriceData?.length || 0,
      liquidityDataLength: liquidityData?.length || 0,
      priceError: priceError?.message,
      hasError: error
    });
  }, [token0, token1, selectedPoolId, isPriceLoading, isLiquidityLoading, rawPriceData?.length, liquidityData?.length, priceError, error]);

  // Parse price bounds
  const currentPriceNum = useMemo(() => {
    if (!currentPrice) return null;
    const parsed = parseFloat(currentPrice);
    return isFinite(parsed) ? parsed : null;
  }, [currentPrice]);

  const minPriceNum = useMemo(() => {
    if (!minPrice) return null;
    const parsed = parseFloat(minPrice);
    return isFinite(parsed) ? parsed : null;
  }, [minPrice]);

  const maxPriceNum = useMemo(() => {
    if (!maxPrice) return null;
    const parsed = parseFloat(maxPrice);
    return isFinite(parsed) ? parsed : null;
  }, [maxPrice]);

  // Track chart height
  useEffect(() => {
    if (chartRef.current) {
      setChartHeight(chartRef.current.clientHeight);
    }
  }, []);

  // Process raw price data to add formatted time
  const priceData = useMemo(() => {
    return rawPriceData.map((point: any) => {
      const date = new Date(point.timestamp * 1000);
      return {
        timestamp: point.timestamp,
        price: point.price,
        formattedTime: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    });
  }, [rawPriceData]);

  // Process liquidity data for depth chart
  const processedLiquidityData = useMemo(() => {
    if (liquidityData.length === 0) return [];

    // Sort by tick
    const sorted = [...liquidityData].sort((a, b) => parseInt(a.tickIdx) - parseInt(b.tickIdx));

    // Calculate cumulative liquidity
    let cumulativeLiquidity = 0n;
    const processed: ProcessedLiquidityPoint[] = [];

    for (const tick of sorted) {
      const tickNum = parseInt(tick.tickIdx);
      cumulativeLiquidity += BigInt(tick.liquidityNet);

      // Convert tick to price: price = 1.0001^tick
      const price = Math.pow(1.0001, tickNum);

      processed.push({
        price: price,
        liquidity: Number(cumulativeLiquidity) / 1e18, // Convert to human-readable
        tick: tickNum
      });
    }

    return processed;
  }, [liquidityData]);

  // Get chart bounds for price chart
  const { chartMinPrice, chartMaxPrice } = useMemo(() => {
    if (priceData.length === 0) return { chartMinPrice: 0, chartMaxPrice: 1 };

    const prices = priceData.map(d => d.price);
    const dataMin = Math.min(...prices);
    const dataMax = Math.max(...prices);

    const range = dataMax - dataMin;
    const padding = range * 0.1;

    return {
      chartMinPrice: Math.max(0, dataMin - padding),
      chartMaxPrice: dataMax + padding,
    };
  }, [priceData]);

  // Add range coloring to price data
  const dataWithRange = useMemo(() => {
    if (!minPriceNum || !maxPriceNum || priceData.length === 0) {
      return priceData.map(point => ({
        ...point,
        inRange: false,
        priceGreen: null,
        priceRed: point.price
      }));
    }

    return priceData.map((point, idx) => {
      const pointInRange = point.price >= minPriceNum && point.price <= maxPriceNum;

      const prevExists = idx > 0;
      const nextExists = idx < priceData.length - 1;
      const prevInRange = prevExists && priceData[idx - 1].price >= minPriceNum && priceData[idx - 1].price <= maxPriceNum;
      const nextInRange = nextExists && priceData[idx + 1].price >= minPriceNum && priceData[idx + 1].price <= maxPriceNum;

      const showGreen = pointInRange || (prevInRange && !pointInRange) || (nextInRange && !pointInRange);
      const showRed = !pointInRange || (!prevInRange && pointInRange) || (!nextInRange && pointInRange);

      return {
        ...point,
        inRange: pointInRange,
        priceGreen: showGreen ? point.price : null,
        priceRed: showRed ? point.price : null
      };
    });
  }, [priceData, minPriceNum, maxPriceNum]);

  // Calculate scale for liquidity bars
  const liquidityScale = useMemo(() => {
    if (processedLiquidityData.length === 0) return { maxLiquidity: 0, scale: () => 0 };

    const maxLiquidity = Math.max(...processedLiquidityData.map(d => d.liquidity));

    return {
      maxLiquidity,
      scale: (liquidity: number) => (liquidity / maxLiquidity) * LIQUIDITY_BAR_WIDTH
    };
  }, [processedLiquidityData]);

  const isLoading = isPriceLoading || isLiquidityLoading;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full w-full", className)}>
        <div className="flex items-center justify-center bg-muted/10 rounded">
          <Image
            src="/LogoIconWhite.svg"
            alt="Loading"
            width={32}
            height={32}
            className="animate-pulse opacity-75"
          />
        </div>
      </div>
    );
  }

  if (error || priceData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full w-full", className)}>
        <div className="h-full w-full bg-muted/10 rounded-lg flex flex-col items-center justify-center gap-2 p-4">
          <span className="text-xs text-muted-foreground text-center">
            {error ? `Error loading chart data: ${priceError?.message || 'Unknown error'}` : 'No chart data available'}
          </span>
          <span className="text-[10px] text-muted-foreground/60 text-center">
            {token0}/{token1} • Pool: {selectedPoolId?.slice(0, 8)}...
          </span>
        </div>
      </div>
    );
  }

  const showMinLine = minPriceNum !== null && minPriceNum >= chartMinPrice && minPriceNum <= chartMaxPrice;
  const showMaxLine = maxPriceNum !== null && maxPriceNum >= chartMinPrice && maxPriceNum <= chartMaxPrice;

  return (
    <div ref={chartRef} className={cn("relative h-full w-full bg-container-secondary/30 rounded-lg p-2", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dataWithRange} margin={CHART_MARGINS}>
          <YAxis
            domain={[chartMinPrice, chartMaxPrice]}
            tick={{ fontSize: 10, fill: '#a3a3a3' }}
            width={AXIS_WIDTH}
            tickFormatter={(value) => {
              if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
              return `$${value.toFixed(value < 1 ? 4 : 2)}`;
            }}
            stroke="#323232"
            tickLine={false}
            axisLine={false}
          />
          <XAxis
            dataKey="formattedTime"
            tick={{ fontSize: 9, fill: '#a3a3a3' }}
            stroke="#323232"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            height={20}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: '#161616',
              border: '1px solid #323232',
              borderRadius: '6px',
              fontSize: '11px',
              padding: '6px 10px'
            }}
            formatter={(value: any) => [`$${Number(value).toFixed(4)}`, 'Price']}
            labelFormatter={(label) => label}
          />

          {minPriceNum !== null && maxPriceNum !== null && (
            <ReferenceArea
              y1={minPriceNum}
              y2={maxPriceNum}
              fill="#22c55e"
              fillOpacity={0.06}
              ifOverflow="hidden"
            />
          )}

          {currentPriceNum !== null && (
            <ReferenceLine
              y={currentPriceNum}
              stroke={isInRange ? '#22c55e' : '#ef4444'}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
          )}

          {showMinLine && (
            <ReferenceLine
              y={minPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.4}
              strokeDasharray="2 2"
              ifOverflow="hidden"
            />
          )}

          {showMaxLine && (
            <ReferenceLine
              y={maxPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.4}
              strokeDasharray="2 2"
              ifOverflow="hidden"
            />
          )}

          <Line
            type="monotone"
            dataKey="priceRed"
            stroke="#ef4444"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: '#ef4444', stroke: '#1f1f1f', strokeWidth: 2 }}
            connectNulls={false}
            animationDuration={300}
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="priceGreen"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: '#22c55e', stroke: '#1f1f1f', strokeWidth: 2 }}
            connectNulls={false}
            animationDuration={300}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {processedLiquidityData.length > 0 && chartHeight > 0 && (
        <svg
          className="absolute pointer-events-none"
          style={{
            top: CHART_MARGINS.top + 8,
            right: CHART_MARGINS.right - LIQUIDITY_BAR_WIDTH - 10,
            height: chartHeight - CHART_MARGINS.top - CHART_MARGINS.bottom,
            width: LIQUIDITY_BAR_WIDTH,
            opacity: 0.7
          }}
        >
          <defs>
            <linearGradient id="liq-gradient-active" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="liq-gradient-inactive" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4a4a4a" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#4a4a4a" stopOpacity="0.3" />
            </linearGradient>
          </defs>

          {processedLiquidityData.map((point, i) => {
            const priceRange = chartMaxPrice - chartMinPrice;
            if (priceRange <= 0) return null;

            const yPercent = (chartMaxPrice - point.price) / priceRange;
            const y = yPercent * (chartHeight - CHART_MARGINS.bottom - CHART_MARGINS.top) + CHART_MARGINS.top;

            if (point.price < chartMinPrice || point.price > chartMaxPrice) return null;

            const barWidth = Math.max(1.5, liquidityScale.scale(point.liquidity));
            const x = AXIS_WIDTH + LIQUIDITY_BAR_WIDTH - barWidth;

            const isInPositionRange = minPriceNum && maxPriceNum &&
                                     point.price >= minPriceNum &&
                                     point.price <= maxPriceNum;

            return (
              <rect
                key={`liq-bar-${i}`}
                x={x}
                y={Math.max(CHART_MARGINS.top, Math.min(y - 0.5, chartHeight - CHART_MARGINS.bottom))}
                width={barWidth}
                height={2}
                fill={isInPositionRange ? 'url(#liq-gradient-active)' : 'url(#liq-gradient-inactive)'}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
