"use client";

/**
 * useUnifiedYieldChartData - Fetches chart data for Unified Yield positions
 *
 * For UY positions, we show:
 * - Swap APR (pool-level, from backend)
 * - Per-token yield source APRs (e.g., "Aave ETH", "Aave USDC", "Spark USDS")
 *
 * Unlike V4 positions, UY positions don't show individual fees (they auto-compound).
 *
 * Data model: Each token has its own yield line (currency0Apy, currency1Apy),
 * labeled with the protocol name + token symbol (e.g., "Aave USDC").
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchUnifiedYieldPoolAprHistory,
  fetchSparkRatesHistory,
} from "@/lib/backend-client";
import { fetchAaveHistory, getTokenProtocol } from "@/lib/aave-rates";
import { useNetwork } from "@/lib/network-context";
import type { YieldSource } from "@/lib/pools-config";

export type ChartPeriod = "1W" | "1M" | "1Y" | "ALL";

export interface UnifiedYieldChartPoint {
  timestamp: number;
  /** Swap APR from pool trading fees (%) */
  swapApr: number;
  /** Yield APY for currency0 (from its yield source, e.g., Aave ETH or Spark USDS) */
  currency0Apy?: number;
  /** Yield APY for currency1 (from its yield source, e.g., Aave USDC) */
  currency1Apy?: number;
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
  /** Protocol used for currency0 yield (for label/color in chart) */
  currency0Protocol?: 'aave' | 'spark';
  /** Protocol used for currency1 yield (for label/color in chart) */
  currency1Protocol?: 'aave' | 'spark';
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
 * Fetch yield history for a single token from its protocol (Aave or Spark)
 */
async function fetchTokenYieldHistory(
  tokenSymbol: string,
  protocol: 'aave' | 'spark',
  frontendPeriod: ChartPeriod,
  backendPeriod: 'DAY' | 'WEEK' | 'MONTH',
): Promise<Array<{ timestamp: number; apy: number }>> {
  if (protocol === 'spark') {
    const mapping = getTokenProtocol(tokenSymbol);
    const key = mapping?.key ?? tokenSymbol;
    const result = await fetchSparkRatesHistory(key, backendPeriod);
    return result.success ? result.points.map(p => ({ timestamp: p.timestamp, apy: p.apy })) : [];
  } else {
    const result = await fetchAaveHistory(tokenSymbol, frontendPeriod);
    return result.success ? result.points.map(p => ({ timestamp: p.timestamp, apy: p.apy })) : [];
  }
}

/**
 * Hook to fetch chart data for Unified Yield positions
 *
 * Fetches per-token yield rates (not per-protocol averaged), enabling labels like
 * "Aave ETH" and "Aave USDC" instead of a single "Aave" line.
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

  // Determine which protocol each token uses
  const token0Protocol = useMemo(
    () => token0Symbol ? getTokenProtocol(token0Symbol)?.protocol : undefined,
    [token0Symbol]
  );
  const token1Protocol = useMemo(
    () => token1Symbol ? getTokenProtocol(token1Symbol)?.protocol : undefined,
    [token1Symbol]
  );

  // Only enable per-token queries if the pool uses that token's protocol
  const hasYieldSources = yieldSources.length > 0;
  const token0HasYield = hasYieldSources && !!token0Protocol && yieldSources.includes(token0Protocol);
  const token1HasYield = hasYieldSources && !!token1Protocol && yieldSources.includes(token1Protocol);

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

  // Fetch yield history for token0 (e.g., Aave ETH or Spark USDS)
  const token0YieldQuery = useQuery({
    queryKey: ["token-yield-history", token0Symbol, token0Protocol, period],
    queryFn: async () => {
      if (!token0Symbol || !token0Protocol) return null;
      return fetchTokenYieldHistory(token0Symbol, token0Protocol, period, backendPeriod);
    },
    enabled: enabled && token0HasYield && !!token0Symbol,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch yield history for token1 (e.g., Aave USDC)
  const token1YieldQuery = useQuery({
    queryKey: ["token-yield-history", token1Symbol, token1Protocol, period],
    queryFn: async () => {
      if (!token1Symbol || !token1Protocol) return null;
      return fetchTokenYieldHistory(token1Symbol, token1Protocol, period, backendPeriod);
    },
    enabled: enabled && token1HasYield && !!token1Symbol,
    staleTime: 5 * 60 * 1000,
  });

  // Merge all data sources - use UNION of all timestamps with forward-fill
  const mergedData = useMemo((): UnifiedYieldChartPoint[] | undefined => {
    const swapData = swapAprQuery.data;
    const token0Data = token0YieldQuery.data;
    const token1Data = token1YieldQuery.data;

    // Convert each source to sorted arrays for forward-fill lookup
    const swapSorted: Array<{ ts: number; val: number }> = [];
    const token0Sorted: Array<{ ts: number; val: number }> = [];
    const token1Sorted: Array<{ ts: number; val: number }> = [];

    if (swapData) {
      for (const p of swapData) {
        swapSorted.push({ ts: p.timestamp, val: p.swapApr ?? 0 });
      }
      swapSorted.sort((a, b) => a.ts - b.ts);
    }
    if (token0Data) {
      for (const p of token0Data) {
        token0Sorted.push({ ts: p.timestamp, val: p.apy });
      }
      token0Sorted.sort((a, b) => a.ts - b.ts);
    }
    if (token1Data) {
      for (const p of token1Data) {
        token1Sorted.push({ ts: p.timestamp, val: p.apy });
      }
      token1Sorted.sort((a, b) => a.ts - b.ts);
    }

    // Collect ALL unique timestamps from all sources
    const allTimestamps = new Set<number>();
    for (const p of swapSorted) allTimestamps.add(p.ts);
    for (const p of token0Sorted) allTimestamps.add(p.ts);
    for (const p of token1Sorted) allTimestamps.add(p.ts);

    // If no data from any source, return undefined
    if (allTimestamps.size === 0) return undefined;

    // Sort timestamps chronologically
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Forward-fill with backward-fill fallback:
    // 1. Find the most recent value at or before targetTs (forward-fill)
    // 2. If no prior data exists, use the EARLIEST known value (backward-fill)
    //    This prevents showing 0% when a data source has sparse/delayed history
    //    (e.g., swap APR has 1 recent point while yield data spans the full period)
    const forwardFill = (
      sorted: Array<{ ts: number; val: number }>,
      targetTs: number
    ): number | undefined => {
      if (sorted.length === 0) return undefined;

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

      // Backward-fill: if targetTs is before all data points, use earliest value
      if (result === undefined) {
        result = sorted[0].val;
      }

      return result;
    };

    // Build merged chart points with forward-filled values
    return sortedTimestamps.map((timestamp) => {
      const swapApr = forwardFill(swapSorted, timestamp) ?? 0;
      const currency0Apy = token0HasYield ? forwardFill(token0Sorted, timestamp) : undefined;
      const currency1Apy = token1HasYield ? forwardFill(token1Sorted, timestamp) : undefined;

      const totalApr = swapApr + (currency0Apy ?? 0) + (currency1Apy ?? 0);

      return {
        timestamp,
        swapApr,
        currency0Apy,
        currency1Apy,
        totalApr,
      };
    });
  }, [swapAprQuery.data, token0YieldQuery.data, token1YieldQuery.data, token0HasYield, token1HasYield]);

  const isLoading = swapAprQuery.isLoading ||
    (token0HasYield && token0YieldQuery.isLoading) ||
    (token1HasYield && token1YieldQuery.isLoading);

  return {
    data: mergedData,
    currency0Protocol: token0HasYield ? token0Protocol : undefined,
    currency1Protocol: token1HasYield ? token1Protocol : undefined,
    isLoading,
    isPending: swapAprQuery.isPending,
    isError: swapAprQuery.isError,
    error: swapAprQuery.error,
    refetch: swapAprQuery.refetch,
  };
}
