"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

/**
 * Chart time periods following Uniswap's pattern
 * Using string values to match the PortfolioChart component
 */
export enum ChartPeriod {
  HOUR = "1H",
  DAY = "1D",
  WEEK = "1W",
  MONTH = "1M",
  YEAR = "1Y",
}

export interface ChartDataPoint {
  timestamp: number; // Unix timestamp in seconds
  value: number; // Portfolio value in USD
}

export interface PortfolioChartData {
  points: ChartDataPoint[];
  startValue: number;
  endValue: number;
  changePercent: number;
  changeAbsolute: number;
}

interface UsePortfolioChartReturn {
  chartData: PortfolioChartData | null;
  isLoading: boolean;
  error: Error | null;
  selectedPeriod: ChartPeriod;
  setSelectedPeriod: (period: ChartPeriod) => void;
}

/**
 * SHORTCUT NOTE:
 * This hook is designed to fetch historical portfolio value data.
 *
 * Uniswap uses their proprietary Data API (getPortfolioChart.ts) which
 * tracks portfolio value snapshots over time.
 *
 * For Alphix, you would need to either:
 * 1. Create an API endpoint that:
 *    - Queries historical position snapshots from subgraph
 *    - Calculates value at each time point using historical prices
 *    - Returns aggregated portfolio value over time
 *
 * 2. OR use a third-party portfolio tracking service
 *
 * 3. OR implement client-side calculation by:
 *    - Storing position snapshots in Supabase
 *    - Fetching historical prices from CoinGecko/similar
 *    - Computing value at each time point
 *
 * Current implementation: Returns mock/placeholder data
 * TODO: Implement /api/portfolio/chart endpoint
 */
export function usePortfolioChart(
  currentPortfolioValue: number = 0
): UsePortfolioChartReturn {
  const { address, isConnected } = useAccount();
  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>(ChartPeriod.WEEK);
  const [chartData, setChartData] = useState<PortfolioChartData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isConnected || !address || currentPortfolioValue <= 0) {
      setChartData(null);
      setIsLoading(false);
      return;
    }

    const fetchChartData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // TODO: Replace with actual API call once endpoint exists
        // const response = await fetch(`/api/portfolio/chart?address=${address}&period=${selectedPeriod}`);
        // const data = await response.json();

        // PLACEHOLDER: Generate mock data based on current value
        // This simulates what the real endpoint would return
        const mockData = generateMockChartData(currentPortfolioValue, selectedPeriod);

        setChartData(mockData);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch chart data"));
        setChartData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchChartData();
  }, [address, isConnected, selectedPeriod, currentPortfolioValue]);

  return {
    chartData,
    isLoading,
    error,
    selectedPeriod,
    setSelectedPeriod,
  };
}

/**
 * Generate mock chart data for visualization
 * This should be replaced with real data from the API
 */
function generateMockChartData(
  currentValue: number,
  period: ChartPeriod
): PortfolioChartData {
  const now = Math.floor(Date.now() / 1000);
  const points: ChartDataPoint[] = [];

  // Determine time range and interval based on period
  let duration: number;
  let interval: number;

  switch (period) {
    case ChartPeriod.HOUR:
      duration = 60 * 60; // 1 hour
      interval = 60; // 1 minute
      break;
    case ChartPeriod.DAY:
      duration = 24 * 60 * 60; // 24 hours
      interval = 15 * 60; // 15 minutes
      break;
    case ChartPeriod.WEEK:
      duration = 7 * 24 * 60 * 60; // 7 days
      interval = 60 * 60; // 1 hour
      break;
    case ChartPeriod.MONTH:
      duration = 30 * 24 * 60 * 60; // 30 days
      interval = 4 * 60 * 60; // 4 hours
      break;
    case ChartPeriod.YEAR:
      duration = 365 * 24 * 60 * 60; // 365 days
      interval = 24 * 60 * 60; // 1 day
      break;
    default:
      duration = 7 * 24 * 60 * 60;
      interval = 60 * 60;
  }

  // Generate points with some randomness to simulate real data
  const startTime = now - duration;
  const numPoints = Math.floor(duration / interval);

  // Random starting value (5-15% different from current)
  const variancePercent = (Math.random() * 10 + 5) * (Math.random() > 0.5 ? 1 : -1);
  const startValue = currentValue / (1 + variancePercent / 100);

  for (let i = 0; i <= numPoints; i++) {
    const timestamp = startTime + (i * interval);
    // Interpolate with some noise
    const progress = i / numPoints;
    const baseValue = startValue + (currentValue - startValue) * progress;
    // Add small random fluctuation (±2%)
    const noise = baseValue * (Math.random() - 0.5) * 0.04;
    const value = Math.max(0, baseValue + noise);

    points.push({ timestamp, value });
  }

  // Ensure last point is exactly current value
  if (points.length > 0) {
    points[points.length - 1].value = currentValue;
  }

  const actualStartValue = points[0]?.value || 0;
  const changeAbsolute = currentValue - actualStartValue;
  const changePercent = actualStartValue > 0 ? (changeAbsolute / actualStartValue) * 100 : 0;

  return {
    points,
    startValue: actualStartValue,
    endValue: currentValue,
    changePercent,
    changeAbsolute,
  };
}

/**
 * Convert chart data to Recharts format
 */
export function formatChartDataForRecharts(data: PortfolioChartData | null) {
  if (!data || !data.points.length) return [];

  return data.points.map((point) => ({
    time: point.timestamp,
    value: point.value,
    // For area charts
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
  }));
}

/**
 * Get period label for display
 */
export function getPeriodLabel(period: ChartPeriod): string {
  switch (period) {
    case ChartPeriod.HOUR:
      return "1H";
    case ChartPeriod.DAY:
      return "1D";
    case ChartPeriod.WEEK:
      return "1W";
    case ChartPeriod.MONTH:
      return "1M";
    case ChartPeriod.YEAR:
      return "1Y";
    default:
      return "1W";
  }
}

/**
 * Get all available period options
 */
export function getPeriodOptions(): Array<{ value: ChartPeriod; label: string }> {
  return [
    { value: ChartPeriod.DAY, label: "1D" },
    { value: ChartPeriod.WEEK, label: "1W" },
    { value: ChartPeriod.MONTH, label: "1M" },
    { value: ChartPeriod.YEAR, label: "1Y" },
  ];
}
