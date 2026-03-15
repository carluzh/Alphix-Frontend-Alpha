"use client";

import { useMemo } from "react";
import type { PoolData } from "@/lib/websocket";

export interface ProtocolStats {
  currentTvl: number;
  volume24h: number;
  userRevenueAllTime: number;
  isLoading: boolean;
}

interface UseProtocolStatsParams {
  pools: PoolData[];
  isLoading: boolean;
}

export function useProtocolStats({
  pools,
  isLoading,
}: UseProtocolStatsParams): ProtocolStats {
  const aggregates = useMemo(() => {
    let currentTvl = 0;
    let volume24h = 0;
    let userRevenueAllTime = 0;

    for (const pool of pools) {
      if (typeof pool.tvlUsd === "number" && isFinite(pool.tvlUsd)) {
        currentTvl += pool.tvlUsd;
      }
      if (typeof pool.volume24hUsd === "number" && isFinite(pool.volume24hUsd)) {
        volume24h += pool.volume24hUsd;
      }
      if (typeof pool.cumulativeFeesUsd === "number" && isFinite(pool.cumulativeFeesUsd)) {
        userRevenueAllTime += pool.cumulativeFeesUsd;
      }
    }

    return { currentTvl, volume24h, userRevenueAllTime };
  }, [pools]);

  return {
    currentTvl: aggregates.currentTvl,
    volume24h: aggregates.volume24h,
    userRevenueAllTime: aggregates.userRevenueAllTime,
    isLoading,
  };
}
