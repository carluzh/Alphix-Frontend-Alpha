"use client";

/**
 * usePositionFeeChartData - Fetches position fee history from AlphixBackend
 *
 * Simple architecture (same as usePositionsChartData):
 * - Backend returns stored historical fee snapshots
 * - Frontend adds the "live now" point using current uncollected fees
 * - Accumulated fees computed from delta vs last point
 * - APR uses last known value (lags 1 point)
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchPositionFees } from "@/lib/backend-client";

export type ChartPeriod = "1W" | "1M" | "1Y" | "ALL";

export interface FeeChartPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
}

interface UsePositionFeeChartDataParams {
  positionId: string | undefined;
  period: ChartPeriod;
  /** Current uncollected fees in USD (for "live now" point) */
  currentFeesUsd?: number;
  enabled?: boolean;
}

interface UsePositionFeeChartDataResult {
  data: FeeChartPoint[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to fetch historical fee data from AlphixBackend
 */
export function usePositionFeeChartData({
  positionId,
  period,
  currentFeesUsd,
  enabled = true,
}: UsePositionFeeChartDataParams): UsePositionFeeChartDataResult {
  const queryKey = ["position-fee-chart", positionId, period];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<FeeChartPoint[]> => {
      if (!positionId) {
        return [];
      }

      const response = await fetchPositionFees(positionId, period);

      if (!response.success) {
        console.warn("[usePositionFeeChartData] Backend error:", response.error);
        return [];
      }

      return response.points;
    },
    enabled: enabled && !!positionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: 1000,
  });

  // Add "live now" point using frontend's current uncollected fees
  // Only adds if we have historical data as baseline (otherwise accumulated fees would be wrong)
  const dataWithLivePoint = useMemo(() => {
    const historicalData = query.data;
    if (!historicalData) return undefined;

    // Need at least one historical point as baseline for accumulated fees
    const lastPoint = historicalData[historicalData.length - 1];
    if (!lastPoint) return historicalData;

    // If we have current fee data, add "now" point
    if (currentFeesUsd !== undefined && currentFeesUsd >= 0) {
      const now = Math.floor(Date.now() / 1000);

      // Only add if it's newer than the last historical point
      if (now > lastPoint.timestamp) {
        // Compute accumulated: last accumulated + delta (if positive)
        const delta = currentFeesUsd - lastPoint.feesUsd;
        const accumulatedFeesUsd = delta > 0
          ? lastPoint.accumulatedFeesUsd + delta
          : lastPoint.accumulatedFeesUsd;

        // APR uses last known value (lags by 1 point)
        const apr = lastPoint.apr;

        return [
          ...historicalData,
          {
            timestamp: now,
            feesUsd: currentFeesUsd,
            accumulatedFeesUsd,
            apr,
          },
        ];
      }
    }

    return historicalData;
  }, [query.data, currentFeesUsd]);

  return {
    data: dataWithLivePoint,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
