"use client";

import React, { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis, ReferenceLine, ReferenceArea } from 'recharts';
import { cn } from '@/lib/utils';
import { usePoolPriceChartData } from '@/lib/chart';
import { HistoryDuration, DataQuality } from '@/lib/chart/types';

interface MiniPoolChartProps {
  token0: string;
  token1: string;
  selectedPoolId: string; // Required for new data fetching
  denominationBase: string; // The base token for denomination (passed from parent)
  currentPrice?: string | null; // Already in display denomination
  minPrice?: string; // Already in display denomination
  maxPrice?: string; // Already in display denomination
  isInRange?: boolean;
  isFullRange?: boolean;
  className?: string;
}

export function MiniPoolChart({
  token0,
  token1,
  selectedPoolId,
  denominationBase,
  currentPrice,
  minPrice,
  maxPrice,
  isInRange,
  isFullRange,
  className
}: MiniPoolChartProps) {
  // Determine if we need to invert the price (matches PositionCardCompact's shouldInvert)
  // When denominationBase === token0, we invert to show "token0 per token1"
  const priceInverted = denominationBase === token0;

  // Fetch data using Uniswap-style hook
  const { entries, loading: isLoading, dataQuality } = usePoolPriceChartData({
    variables: {
      poolId: selectedPoolId,
      token0,
      token1,
      duration: HistoryDuration.WEEK,
    },
    priceInverted,
  });

  const hasError = dataQuality === DataQuality.INVALID;

  // Transform entries to data format for recharts
  const data = useMemo(() => {
    return entries.map((entry) => ({
      timestamp: entry.time,
      price: entry.value,
    }));
  }, [entries]);

  // Parse price bounds (already in display denomination from parent)
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

  const { chartMinPrice, chartMaxPrice } = useMemo(() => {
    if (data.length === 0) return { chartMinPrice: 0, chartMaxPrice: 1 };

    const prices = data.map((d: any) => d.price);
    const dataMin = Math.min(...prices);
    const dataMax = Math.max(...prices);
    const range = dataMax - dataMin;
    const padding = range * 0.05;

    let minBound = dataMin - padding;
    let maxBound = dataMax + padding;

    if (isInRange === false && minPriceNum && maxPriceNum) {
      const priceRef = currentPriceNum ?? dataMax;
      if (priceRef < minPriceNum) {
        maxBound = minPriceNum + (minPriceNum - dataMin) * 0.05;
      } else if (priceRef > maxPriceNum) {
        minBound = maxPriceNum - (dataMax - maxPriceNum) * 0.05;
      }
    }

    return { chartMinPrice: minBound, chartMaxPrice: maxBound };
  }, [data, isInRange, currentPriceNum, minPriceNum, maxPriceNum]);

  // Color each data point based on whether it's in range
  const dataWithRange = useMemo(() => {
    if (data.length === 0) {
      return [];
    }

    // If Full Range, entire line is green
    if (isFullRange) {
      return data.map((point: any) => ({
        ...point,
        inRange: true,
        priceGreen: point.price,
        priceRed: null
      }));
    }

    // Otherwise, use min/max price logic
    if (!minPriceNum || !maxPriceNum) {
      return data.map((point: any) => ({ ...point, inRange: false, priceGreen: null, priceRed: point.price }));
    }

    return data.map((point: any, idx: number) => {
      const pointInRange = point.price >= minPriceNum && point.price <= maxPriceNum;
      const prevInRange = idx > 0 && data[idx - 1].price >= minPriceNum && data[idx - 1].price <= maxPriceNum;
      const nextInRange = idx < data.length - 1 && data[idx + 1].price >= minPriceNum && data[idx + 1].price <= maxPriceNum;

      // Show green if point is in range or at transition boundaries
      const showGreen = pointInRange || (prevInRange && !pointInRange) || (nextInRange && !pointInRange);
      // Show red if point is out of range or at transition boundaries
      const showRed = !pointInRange || (!prevInRange && pointInRange) || (!nextInRange && pointInRange);

      return {
        ...point,
        inRange: pointInRange,
        priceGreen: showGreen ? point.price : null,
        priceRed: showRed ? point.price : null
      };
    });
  }, [data, minPriceNum, maxPriceNum, isFullRange]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center cursor-pointer", className)}>
        <div className="h-full w-full bg-muted/20 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (hasError || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center cursor-pointer", className)}>
        <div className="h-full w-full bg-muted/10 rounded-lg flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No data</span>
        </div>
      </div>
    );
  }

  const showMinLine = minPriceNum !== null && minPriceNum >= chartMinPrice && minPriceNum <= chartMaxPrice;
  const showMaxLine = maxPriceNum !== null && maxPriceNum >= chartMinPrice && maxPriceNum <= chartMaxPrice;

  return (
    <div className={cn("relative cursor-pointer", className)}>
      <div className="absolute inset-0 pointer-events-none">
        <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={dataWithRange}
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        >
          <YAxis
            domain={[chartMinPrice, chartMaxPrice]}
            hide={true}
          />

          {minPriceNum !== null && maxPriceNum !== null && (
            <ReferenceArea
              y1={minPriceNum}
              y2={maxPriceNum}
              fill="#22c55e"
              fillOpacity={0.1}
              ifOverflow="visible"
            />
          )}


          {showMinLine && (
            <ReferenceLine
              y={minPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.6}
              ifOverflow="visible"
            />
          )}

          {showMaxLine && (
            <ReferenceLine
              y={maxPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.6}
              ifOverflow="visible"
            />
          )}

          {/* Out-of-range line (red) */}
          <Line
            type="monotone"
            dataKey="priceRed"
            stroke="#ef4444"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            connectNulls={false}
            animationDuration={300}
            isAnimationActive={false}
          />

          {/* In-range line (green) */}
          <Line
            type="monotone"
            dataKey="priceGreen"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            connectNulls={false}
            animationDuration={300}
            isAnimationActive={false}
          />
        </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
