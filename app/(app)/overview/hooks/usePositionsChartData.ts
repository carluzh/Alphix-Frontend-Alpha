"use client";

/**
 * usePositionsChartData — Portfolio chart series, sourced from AlphixBackend only.
 *
 * Architecture:
 * - Backend returns timestamped snapshots (already summed across chains).
 * - SSE notifications trigger a query invalidation so the next render fetches
 *   the freshly-recorded snapshot — no FE-side live-value computation.
 * - The chart's pulsating "live" dot renders on the last point of the series,
 *   which is now always the latest backend snapshot.
 *
 * Why no FE-derived "live now" point: it used to be computed from
 * `currentTotalValue = sum(positions × prices)`, which is a derived value with
 * many flicker sources (Apollo refetch, useTokenPrices refetch, UY position
 * refresh). Any momentary drop produced a visible nose-dive on the chart's
 * right edge. The backend value is single-source-of-truth; using it directly
 * is both simpler and stable.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchPositionsChart } from "@/lib/backend-client";
import { useSSEContext } from "@/lib/realtime";
import { ALL_MODES } from "@/lib/chain-registry";

export type ChartPeriod = "DAY" | "WEEK" | "MONTH";

const CHART_MODES = ALL_MODES;

export interface PositionsChartPoint {
  timestamp: number;
  value: number;
}

interface UsePositionsChartDataParams {
  address: string | undefined;
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
  isSSEConnected: boolean;
  /** Start timestamp of the visible range (from backend) */
  fromTimestamp: number | undefined;
  /** End timestamp of the visible range (from backend) */
  toTimestamp: number | undefined;
}

export function usePositionsChartData({
  address,
  period,
  enabled = true,
}: UsePositionsChartDataParams): UsePositionsChartDataResult {
  const queryClient = useQueryClient();
  const { subscribeToSnapshots, isConnected } = useSSEContext();

  const queryKey = ["positions-chart", address, period, "all-chains"];
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

      // Fetch chart data from all chains in parallel
      const results = await Promise.allSettled(
        CHART_MODES.map(mode => fetchPositionsChart(address, period, mode))
      );

      // Merge points by timestamp — sum values across chains
      const valueByTimestamp = new Map<number, number>();
      let minFrom = Infinity;
      let maxTo = 0;

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.success) continue;
        const response = result.value;
        if (response.fromTimestamp < minFrom) minFrom = response.fromTimestamp;
        if (response.toTimestamp > maxTo) maxTo = response.toTimestamp;
        for (const point of response.points) {
          const existing = valueByTimestamp.get(point.timestamp) || 0;
          valueByTimestamp.set(point.timestamp, existing + point.positionsValue);
        }
      }

      if (valueByTimestamp.size === 0) {
        timeRangeRef.current = null;
        return [];
      }

      timeRangeRef.current = {
        from: minFrom === Infinity ? 0 : minFrom,
        to: maxTo,
      };

      return Array.from(valueByTimestamp.entries())
        .map(([timestamp, value]) => ({ timestamp, value }))
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    enabled: enabled && !!address,
    staleTime: 0, // Always refetch when period changes
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 1000,
  });

  // SSE: when the backend records a new snapshot, invalidate the query so the
  // next render pulls it in. We do NOT extract values from the SSE payload —
  // it's per-chain only, and we'd rather pay one refetch than try to merge
  // single-chain SSE deltas into a cross-chain series here.
  useEffect(() => {
    if (!enabled || !address) return;

    const unsubscribe = subscribeToSnapshots(() => {
      queryClient.invalidateQueries({ queryKey: queryKeyRef.current });
    });

    return () => unsubscribe();
  }, [enabled, address, queryClient, subscribeToSnapshots]);

  return {
    data: query.data,
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
