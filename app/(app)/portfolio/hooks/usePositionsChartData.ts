"use client";

/**
 * usePositionsChartData - Fetches position value history from AlphixBackend
 *
 * Uses the backend's /portfolio/chart endpoint to calculate historical
 * position values based on pool snapshots and Uniswap math.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchPositionsChart, type PositionInput } from "@/lib/backend-client";

export type ChartPeriod = "DAY" | "WEEK" | "MONTH";

export interface PositionsChartPoint {
  timestamp: number;
  value: number;
}

interface UsePositionsChartDataParams {
  address: string | undefined;
  positions: PositionInput[] | undefined;
  period: ChartPeriod;
  enabled?: boolean;
}

interface UsePositionsChartDataResult {
  data: PositionsChartPoint[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to fetch historical position values from AlphixBackend
 */
export function usePositionsChartData({
  address,
  positions,
  period,
  enabled = true,
}: UsePositionsChartDataParams): UsePositionsChartDataResult {
  const query = useQuery({
    queryKey: ["positions-chart", address, period, positions?.length],
    queryFn: async (): Promise<PositionsChartPoint[]> => {
      if (!address || !positions || positions.length === 0) {
        return [];
      }

      const response = await fetchPositionsChart(address, positions, period);

      if (!response.success) {
        console.warn("[usePositionsChartData] Backend error:", response.error);
        return [];
      }

      return response.points.map((point) => ({
        timestamp: point.timestamp,
        value: point.positionsValue,
      }));
    },
    enabled: enabled && !!address && !!positions && positions.length > 0,
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
 * Convert active positions from portfolio data to PositionInput format
 */
export function positionsToInputFormat(
  positions: Array<{
    positionId: string;
    poolId: string;
    token0?: { symbol: string; amount: string };
    token1?: { symbol: string; amount: string };
    liquidity?: string;
    tickLower?: number;
    tickUpper?: number;
    token0UncollectedFees?: string;
    token1UncollectedFees?: string;
  }>
): PositionInput[] {
  return positions
    .filter((p) => p.liquidity && p.tickLower !== undefined && p.tickUpper !== undefined)
    .map((p) => ({
      positionId: p.positionId,
      poolId: p.poolId,
      liquidity: p.liquidity!,
      tickLower: p.tickLower!,
      tickUpper: p.tickUpper!,
      token0UncollectedFees: p.token0UncollectedFees,
      token1UncollectedFees: p.token1UncollectedFees,
    }));
}
