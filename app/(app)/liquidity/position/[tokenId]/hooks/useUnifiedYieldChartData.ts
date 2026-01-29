"use client";

/**
 * useUnifiedYieldChartData - Fetches chart data for Unified Yield positions
 *
 * For UY positions, we show:
 * - Swap APR (pool-level, from backend)
 * - Yield source APRs (Aave, Spark) based on pool config
 *
 * Unlike V4 positions, UY positions don't show individual fees (they auto-compound).
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchUnifiedYieldPoolAprHistory,
  fetchSparkRatesHistory,
} from "@/lib/backend-client";
import type { NetworkMode } from "@/lib/network-mode";
import { fetchAaveHistory } from "@/lib/aave-rates";
import { useNetwork } from "@/lib/network-context";
import type { YieldSource } from "@/lib/pools-config";

export type ChartPeriod = "1W" | "1M" | "1Y" | "ALL";

export interface UnifiedYieldChartPoint {
  timestamp: number;
  /** Swap APR from pool trading fees (%) */
  swapApr: number;
  /** Aave lending APY (%) - only if pool uses Aave */
  aaveApy?: number;
  /** Spark lending APY (%) - only if pool uses Spark */
  sparkApy?: number;
  /** Combined total APR (swap + yield sources) */
  totalApr: number;
}

interface UseUnifiedYieldChartDataParams {
  poolId: string | undefined;
  period: ChartPeriod;
  /** Yield sources from pool config */
  yieldSources?: YieldSource[];
  /** Token symbols for yield source rate lookup */
  token0Symbol?: string;
  token1Symbol?: string;
  enabled?: boolean;
}

interface UseUnifiedYieldChartDataResult {
  data: UnifiedYieldChartPoint[] | undefined;
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Map frontend period to backend period format
 */
function mapPeriodToBackend(period: ChartPeriod): 'DAY' | 'WEEK' | 'MONTH' {
  switch (period) {
    case '1W': return 'WEEK';
    case '1M': return 'MONTH';
    case '1Y': return 'MONTH';
    case 'ALL': return 'MONTH';
    default: return 'WEEK';
  }
}

/**
 * Hook to fetch chart data for Unified Yield positions
 */
export function useUnifiedYieldChartData({
  poolId,
  period,
  yieldSources = [],
  token0Symbol,
  token1Symbol,
  enabled = true,
}: UseUnifiedYieldChartDataParams): UseUnifiedYieldChartDataResult {
  const { networkMode } = useNetwork();
  const backendPeriod = mapPeriodToBackend(period);

  const hasAave = yieldSources.includes('aave');
  const hasSpark = yieldSources.includes('spark');

  // Fetch swap APR history
  const swapAprQuery = useQuery({
    queryKey: ["uy-swap-apr", poolId, period, networkMode],
    queryFn: async () => {
      if (!poolId) return null;
      const result = await fetchUnifiedYieldPoolAprHistory(poolId, backendPeriod, networkMode);
      return result.success ? result.points : [];
    },
    enabled: enabled && !!poolId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch Aave rates history (if pool uses Aave)
  const aaveQuery = useQuery({
    queryKey: ["aave-history", token0Symbol, token1Symbol, period],
    queryFn: async () => {
      if (!token0Symbol || !token1Symbol) return null;
      // Fetch for both tokens, average them
      const [h0, h1] = await Promise.all([
        fetchAaveHistory(token0Symbol, period),
        fetchAaveHistory(token1Symbol, period),
      ]);
      // Merge and average
      const map = new Map<number, { apy0?: number; apy1?: number }>();
      if (h0.success) {
        for (const p of h0.points) {
          map.set(p.timestamp, { apy0: p.apy });
        }
      }
      if (h1.success) {
        for (const p of h1.points) {
          const existing = map.get(p.timestamp) || {};
          map.set(p.timestamp, { ...existing, apy1: p.apy });
        }
      }
      return Array.from(map.entries())
        .map(([timestamp, { apy0, apy1 }]) => ({
          timestamp,
          apy: apy0 !== undefined && apy1 !== undefined
            ? (apy0 + apy1) / 2
            : apy0 ?? apy1 ?? 0,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    enabled: enabled && hasAave && !!token0Symbol && !!token1Symbol,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch Spark rates history (if pool uses Spark)
  // Spark typically uses DAI/USDS
  const sparkQuery = useQuery({
    queryKey: ["spark-history", token0Symbol, token1Symbol, period],
    queryFn: async () => {
      if (!token0Symbol || !token1Symbol) return null;
      // Try DAI first, then USDS
      const token = ['DAI', 'USDS'].find(t =>
        token0Symbol.toUpperCase().includes(t) || token1Symbol.toUpperCase().includes(t)
      ) || 'DAI';
      const result = await fetchSparkRatesHistory(token, backendPeriod);
      return result.success ? result.points : [];
    },
    enabled: enabled && hasSpark && !!token0Symbol && !!token1Symbol,
    staleTime: 5 * 60 * 1000,
  });

  // Merge all data sources - use UNION of all timestamps with forward-fill
  const mergedData = useMemo((): UnifiedYieldChartPoint[] | undefined => {
    const swapData = swapAprQuery.data;
    const aaveData = aaveQuery.data;
    const sparkData = sparkQuery.data;

    // Convert each source to sorted arrays for forward-fill lookup
    const swapSorted: Array<{ ts: number; val: number }> = [];
    const aaveSorted: Array<{ ts: number; val: number }> = [];
    const sparkSorted: Array<{ ts: number; val: number }> = [];

    if (swapData) {
      for (const p of swapData) {
        const apr = (p as any).swapApr ?? (p as any).apr ?? 0;
        swapSorted.push({ ts: p.timestamp, val: apr });
      }
      swapSorted.sort((a, b) => a.ts - b.ts);
    }
    if (aaveData) {
      for (const p of aaveData) {
        aaveSorted.push({ ts: p.timestamp, val: p.apy });
      }
      aaveSorted.sort((a, b) => a.ts - b.ts);
    }
    if (sparkData) {
      for (const p of sparkData) {
        sparkSorted.push({ ts: p.timestamp, val: p.apy });
      }
      sparkSorted.sort((a, b) => a.ts - b.ts);
    }

    // Collect ALL unique timestamps from all sources
    const allTimestamps = new Set<number>();
    for (const p of swapSorted) allTimestamps.add(p.ts);
    for (const p of aaveSorted) allTimestamps.add(p.ts);
    for (const p of sparkSorted) allTimestamps.add(p.ts);

    // If no data from any source, return undefined
    if (allTimestamps.size === 0) return undefined;

    // Sort timestamps chronologically
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Forward-fill: find the most recent value at or before targetTs
    // APY data is valid until the next update, so we carry forward the last known value
    const forwardFill = (
      sorted: Array<{ ts: number; val: number }>,
      targetTs: number
    ): number | undefined => {
      // Binary search for the largest ts <= targetTs
      let left = 0;
      let right = sorted.length - 1;
      let result: number | undefined;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (sorted[mid].ts <= targetTs) {
          result = sorted[mid].val;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }
      return result;
    };

    // Build merged chart points with forward-filled values
    return sortedTimestamps.map((timestamp) => {
      const swapApr = forwardFill(swapSorted, timestamp) ?? 0;
      const aaveApy = hasAave ? forwardFill(aaveSorted, timestamp) : undefined;
      const sparkApy = hasSpark ? forwardFill(sparkSorted, timestamp) : undefined;

      const totalApr = swapApr + (aaveApy ?? 0) + (sparkApy ?? 0);

      return {
        timestamp,
        swapApr,
        aaveApy,
        sparkApy,
        totalApr,
      };
    });
  }, [swapAprQuery.data, aaveQuery.data, sparkQuery.data, hasAave, hasSpark]);

  const isLoading = swapAprQuery.isLoading ||
    (hasAave && aaveQuery.isLoading) ||
    (hasSpark && sparkQuery.isLoading);

  return {
    data: mergedData,
    isLoading,
    isPending: swapAprQuery.isPending,
    isError: swapAprQuery.isError,
    error: swapAprQuery.error,
    refetch: swapAprQuery.refetch,
  };
}
