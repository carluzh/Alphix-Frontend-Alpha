"use client";

/**
 * usePositionsChartData - Fetches position value history from AlphixBackend
 *
 * Simple architecture:
 * - Backend returns stored historical values (SUM of position_snapshots.value_usd)
 * - Frontend adds the "live now" point using position data it already has
 * - SSE updates append new points in real-time
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useMemo } from "react";
import { fetchPositionsChart } from "@/lib/backend-client";
import { useSSEContext } from "@/lib/realtime";

export type ChartPeriod = "DAY" | "WEEK" | "MONTH";

export interface PositionsChartPoint {
  timestamp: number;
  value: number;
}

interface UsePositionsChartDataParams {
  address: string | undefined;
  period: ChartPeriod;
  /** Current total value calculated by frontend (for "live now" point) */
  currentTotalValue?: number;
  enabled?: boolean;
}

interface UsePositionsChartDataResult {
  data: PositionsChartPoint[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isSSEConnected: boolean;
  /** Start timestamp of the visible range (from backend) */
  fromTimestamp: number | undefined;
  /** End timestamp of the visible range (from backend) */
  toTimestamp: number | undefined;
}

/**
 * Hook to fetch historical position values from AlphixBackend
 * with real-time updates via SSE
 */
export function usePositionsChartData({
  address,
  period,
  currentTotalValue,
  enabled = true,
}: UsePositionsChartDataParams): UsePositionsChartDataResult {
  const queryClient = useQueryClient();
  const { subscribeToSnapshots, isConnected } = useSSEContext();

  const queryKey = ["positions-chart", address, period];
  // Use ref to avoid stale closure in subscription callback
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  // Store time range from backend response
  const timeRangeRef = useRef<{ from: number; to: number } | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<PositionsChartPoint[]> => {
      if (!address) {
        timeRangeRef.current = null;
        return [];
      }

      const response = await fetchPositionsChart(address, period);

      if (!response.success) {
        timeRangeRef.current = null;
        return [];
      }

      // Store the time range from backend
      timeRangeRef.current = {
        from: response.fromTimestamp,
        to: response.toTimestamp,
      };

      return response.points.map((point) => ({
        timestamp: point.timestamp,
        value: point.positionsValue,
      }));
    },
    enabled: enabled && !!address,
    staleTime: 0, // Always refetch when period changes
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
  });

  // Subscribe to SSE snapshots and append new points to chart
  useEffect(() => {
    if (!enabled || !address) return;

    const unsubscribe = subscribeToSnapshots((snapshot) => {
      // Calculate total value from all positions in the snapshot
      const totalValue = snapshot.positions.reduce(
        (sum, pos) => sum + pos.valueUsd,
        0
      );

      const newPoint: PositionsChartPoint = {
        timestamp: snapshot.timestamp,
        value: totalValue,
      };

      // Use ref to get current queryKey (avoids stale closure)
      queryClient.setQueryData<PositionsChartPoint[]>(
        queryKeyRef.current,
        (oldData) => {
          if (!oldData) return [newPoint];

          // Check if we already have this timestamp (avoid duplicates)
          const exists = oldData.some(
            (p) => p.timestamp === newPoint.timestamp
          );
          if (exists) {
            // Update existing point
            return oldData.map((p) =>
              p.timestamp === newPoint.timestamp ? newPoint : p
            );
          }

          // Append and sort by timestamp
          const updated = [...oldData, newPoint].sort(
            (a, b) => a.timestamp - b.timestamp
          );

          console.log("[usePositionsChartData] SSE update - new point:", newPoint);
          return updated;
        }
      );
    });

    return () => unsubscribe();
  }, [enabled, address, queryClient, subscribeToSnapshots]);

  // Add "live now" point using frontend's current total value
  const dataWithLivePoint = useMemo(() => {
    const historicalData = query.data;
    if (!historicalData) return undefined;

    // If we have a current total value from frontend, append it as the "now" point
    if (currentTotalValue !== undefined && currentTotalValue > 0) {
      const now = Math.floor(Date.now() / 1000);
      const lastPoint = historicalData[historicalData.length - 1];

      // Only add if it's newer than the last historical point
      if (!lastPoint || now > lastPoint.timestamp) {
        return [
          ...historicalData,
          { timestamp: now, value: currentTotalValue },
        ];
      }
    }

    return historicalData;
  }, [query.data, currentTotalValue]);

  return {
    data: dataWithLivePoint,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isSSEConnected: isConnected,
    fromTimestamp: timeRangeRef.current?.from,
    toTimestamp: timeRangeRef.current?.to,
  };
}
