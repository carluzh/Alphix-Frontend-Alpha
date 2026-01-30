"use client";

/**
 * usePositionFeeChartData - Fetches position fee history from AlphixBackend
 *
 * Simple architecture (same as usePositionsChartData):
 * - Backend returns stored historical fee snapshots
 * - Frontend adds the "live now" point using current uncollected fees
 * - Accumulated fees computed from delta vs last point
 * - APR uses last known value (lags 1 point)
 *
 * For rehypo positions, also fetches Aave historical rates and merges them
 * to show combined APR (swap APR + Aave APY).
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchPositionFees } from "@/lib/backend-client";
import { fetchPositionAaveHistory } from "@/lib/aave-rates";
import { useNetwork } from "@/lib/network-context";

export type ChartPeriod = "1W" | "1M" | "1Y" | "ALL";

export interface FeeChartPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
  /** Yield APY for currency0 (for rehypo positions) */
  currency0Apy?: number;
  /** Combined APR (swap APR + yield APY) */
  totalApr?: number;
}

interface UsePositionFeeChartDataParams {
  positionId: string | undefined;
  period: ChartPeriod;
  /** Current uncollected fees in USD (for "live now" point) */
  currentFeesUsd?: number;
  enabled?: boolean;
  /** Token symbols for Aave rate lookup (rehypo positions) */
  token0Symbol?: string;
  token1Symbol?: string;
  /** Whether this is a rehypo position (enables Aave rate fetching) */
  isRehypo?: boolean;
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
  token0Symbol,
  token1Symbol,
  isRehypo = false,
}: UsePositionFeeChartDataParams): UsePositionFeeChartDataResult {
  const { networkMode } = useNetwork();
  const queryKey = ["position-fee-chart", positionId, period, networkMode];

  // Fetch position fee history
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<FeeChartPoint[]> => {
      if (!positionId) {
        return [];
      }

      const response = await fetchPositionFees(positionId, period, networkMode);

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

  // Fetch Aave historical rates for rehypo positions
  const aaveQuery = useQuery({
    queryKey: ["aave-history", token0Symbol, token1Symbol, period],
    queryFn: async () => {
      if (!token0Symbol || !token1Symbol) return null;
      return fetchPositionAaveHistory(token0Symbol, token1Symbol, period);
    },
    enabled: enabled && isRehypo && !!token0Symbol && !!token1Symbol,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Merge fee data with Aave historical rates (for rehypo positions)
  const mergedData = useMemo(() => {
    const historicalData = query.data;
    if (!historicalData) return undefined;

    // If no Aave data or not rehypo, return fee data as-is
    const aaveData = aaveQuery.data;
    if (!aaveData?.success || !aaveData.points.length) {
      return historicalData.map(point => ({
        ...point,
        currency0Apy: undefined,
        totalApr: point.apr,
      }));
    }

    // Create a map of Aave APY by timestamp for quick lookup
    const aaveByTimestamp = new Map<number, number>();
    for (const p of aaveData.points) {
      aaveByTimestamp.set(p.timestamp, p.apy);
    }

    // Merge: for each fee point, find the closest Aave point
    return historicalData.map(feePoint => {
      // Find exact match first
      let currency0Apy = aaveByTimestamp.get(feePoint.timestamp);

      // If no exact match, find closest Aave point within 1 hour
      if (currency0Apy === undefined) {
        const oneHour = 3600;
        let closestDiff = Infinity;
        for (const [ts, apy] of aaveByTimestamp) {
          const diff = Math.abs(ts - feePoint.timestamp);
          if (diff < closestDiff && diff <= oneHour) {
            closestDiff = diff;
            currency0Apy = apy;
          }
        }
      }

      return {
        ...feePoint,
        currency0Apy,
        totalApr: feePoint.apr + (currency0Apy ?? 0),
      };
    });
  }, [query.data, aaveQuery.data]);

  // Add "live now" point using frontend's current uncollected fees
  // Only adds if we have historical data as baseline (otherwise accumulated fees would be wrong)
  const dataWithLivePoint = useMemo(() => {
    if (!mergedData) return undefined;

    // Need at least one historical point as baseline for accumulated fees
    const lastPoint = mergedData[mergedData.length - 1];
    if (!lastPoint) return mergedData;

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

        // APR and Aave APY use last known values (lag by 1 point)
        const apr = lastPoint.apr;
        const currency0Apy = lastPoint.currency0Apy;

        return [
          ...mergedData,
          {
            timestamp: now,
            feesUsd: currentFeesUsd,
            accumulatedFeesUsd,
            apr,
            currency0Apy,
            totalApr: apr + (currency0Apy ?? 0),
          },
        ];
      }
    }

    return mergedData;
  }, [mergedData, currentFeesUsd]);

  return {
    data: dataWithLivePoint,
    isLoading: query.isLoading || aaveQuery.isLoading,
    isPending: query.isPending || aaveQuery.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
