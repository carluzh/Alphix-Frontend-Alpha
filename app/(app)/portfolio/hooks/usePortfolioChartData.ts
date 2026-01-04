"use client";

/**
 * usePortfolioChartData - Fetches historical portfolio value from Uniswap API
 *
 * Uses our server-side proxy at /api/portfolio/chart which calls Uniswap's
 * GetPortfolioChart API. Returns timestamped portfolio values for charting.
 */

import { useQuery } from "@tanstack/react-query";

// Chart time period options
export type ChartPeriod = "DAY" | "WEEK" | "MONTH";

export interface PortfolioChartPoint {
  timestamp: number;
  value: number;
}

interface UsePortfolioChartDataParams {
  address: string | undefined;
  period: ChartPeriod;
  enabled?: boolean;
}

interface UsePortfolioChartDataResult {
  data: PortfolioChartPoint[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch portfolio chart data from our API
 */
async function fetchPortfolioChart(
  address: string,
  period: ChartPeriod
): Promise<PortfolioChartPoint[]> {
  const response = await fetch(
    `/api/portfolio/chart?address=${encodeURIComponent(address)}&period=${period}`
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.points || [];
}

/**
 * Hook to fetch historical portfolio values from Uniswap API
 */
export function usePortfolioChartData({
  address,
  period,
  enabled = true,
}: UsePortfolioChartDataParams): UsePortfolioChartDataResult {
  const query = useQuery({
    queryKey: ["portfolio-chart", address, period],
    queryFn: async (): Promise<PortfolioChartPoint[]> => {
      if (!address) {
        return [];
      }
      return fetchPortfolioChart(address, period);
    },
    enabled: enabled && !!address,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    retry: 2,
    retryDelay: 1000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Get display label for chart period
 */
export function getChartPeriodLabel(period: ChartPeriod): string {
  switch (period) {
    case "DAY":
      return "1D";
    case "WEEK":
      return "1W";
    case "MONTH":
      return "1M";
    default:
      return "1M";
  }
}
