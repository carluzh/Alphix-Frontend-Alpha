"use client";

import React, { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis, ReferenceLine, ReferenceArea } from 'recharts';
import { cn } from '@/lib/utils';
import { usePoolChartData } from '@/hooks/usePoolChartData';

interface MiniPoolChartProps {
  token0: string;
  token1: string;
  denominationBase: string; // The base token for denomination (passed from parent)
  currentPrice?: string | null; // Already in display denomination
  minPrice?: string; // Already in display denomination
  maxPrice?: string; // Already in display denomination
  isInRange?: boolean;
  className?: string;
}

export function MiniPoolChart({
  token0,
  token1,
  denominationBase,
  currentPrice,
  minPrice,
  maxPrice,
  isInRange,
  className
}: MiniPoolChartProps) {
  const { data: priceResult, isLoading, error: priceError } = usePoolChartData(token0, token1);
  const error = !!priceError;

  // Transform API data - NO inversion needed
  // The API already returns data in the correct display format
  const data = useMemo(() => {
    const rawData = priceResult?.data || [];
    if (rawData.length === 0) return [];

    // Don't invert - API returns data ready for display
    return rawData;
  }, [priceResult]);

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

  // Calculate chart bounds with padding
  // Focus on actual price data, not range bounds
  const { chartMinPrice, chartMaxPrice } = useMemo(() => {
    if (data.length === 0) return { chartMinPrice: 0, chartMaxPrice: 1 };

    const prices = data.map((d: any) => d.price);
    const dataMin = Math.min(...prices);
    const dataMax = Math.max(...prices);

    // Use only the actual price data for chart bounds
    const range = dataMax - dataMin;
    const padding = range * 0.1; // 10% padding

    return {
      chartMinPrice: dataMin - padding,
      chartMaxPrice: dataMax + padding
    };
  }, [data]);

  // Color each data point based on whether it's in range
  const dataWithRange = useMemo(() => {
    if (!minPriceNum || !maxPriceNum || data.length === 0) {
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
  }, [data, minPriceNum, maxPriceNum]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <div className="h-full w-full bg-muted/20 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <div className="h-full w-full bg-muted/10 rounded-lg flex items-center justify-center">
          <span className="text-xs text-muted-foreground">No data</span>
        </div>
      </div>
    );
  }

  // Check if range bounds are visible in chart
  const showMinLine = minPriceNum !== null && minPriceNum >= chartMinPrice && minPriceNum <= chartMaxPrice;
  const showMaxLine = maxPriceNum !== null && maxPriceNum >= chartMinPrice && maxPriceNum <= chartMaxPrice;

  return (
    <div className={cn("relative", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={dataWithRange}
          margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        >
          <YAxis
            domain={[chartMinPrice, chartMaxPrice]}
            hide={true}
          />

          {/* Green area between position bounds (always shown if bounds exist) */}
          {minPriceNum !== null && maxPriceNum !== null && (
            <ReferenceArea
              y1={minPriceNum}
              y2={maxPriceNum}
              fill="#22c55e"
              fillOpacity={0.1}
              ifOverflow="hidden"
            />
          )}


          {/* Position lower bound line */}
          {showMinLine && (
            <ReferenceLine
              y={minPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.6}
              ifOverflow="hidden"
            />
          )}

          {/* Position upper bound line */}
          {showMaxLine && (
            <ReferenceLine
              y={maxPriceNum}
              stroke="#22c55e"
              strokeWidth={1}
              strokeOpacity={0.6}
              ifOverflow="hidden"
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
  );
}
