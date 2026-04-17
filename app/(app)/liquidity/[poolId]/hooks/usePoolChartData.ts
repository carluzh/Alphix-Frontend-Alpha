"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { RetryUtility } from "@/lib/retry-utility";
import { toast } from "sonner";

export interface ChartDataPoint {
  date: string;
  volumeUSD: number;
  tvlUSD: number;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number;
  volatility?: number;
  agentAdjustment?: number;
  /** Pro pool: buy fee in percentage form (bps / 10000) */
  buyFee?: number;
  /** Pro pool: sell fee in percentage form (bps / 10000) */
  sellFee?: number;
}

/** Raw fee event from the API — per-event granularity */
export interface FeeEvent {
  timestamp: string;
  // Volatile pool fields
  newFeeBps?: string;
  currentRatio?: string;
  newTargetRatio?: string;
  volatility?: number;
  agentAdjustment?: number;
  // Pro pool fields (AlphixPro asymmetric fees)
  buyFeeBps?: string;
  sellFeeBps?: string;
  pokeType?: 'both' | 'buy' | 'sell';
}

interface UsePoolChartDataOptions {
  poolSlug: string;
  poolId: string;
  networkMode: string;
  windowWidth: number;
  currentFeeBps?: number | null;
  /** Volatile pools always re-fetch fee events (no caching) */
  isVolatilePool?: boolean;
  /** Pro pools always re-fetch fee events (no caching) */
  isProPool?: boolean;
  /** Latest volatility from WebSocket pools:metrics */
  currentVolatility?: number | null;
  /** Latest agent adjustment from WebSocket pools:metrics */
  currentAgentAdjustment?: number | null;
}

interface UsePoolChartDataReturn {
  /** Daily-bucketed chart data (Volume/TVL/Fee for standard pools, Volume/TVL for all) */
  chartData: ChartDataPoint[];
  /** Raw fee events — per-event granularity for pools with dynamic fees */
  feeEvents: FeeEvent[];
  isLoadingChartData: boolean;
  fetchChartData: (force?: boolean) => Promise<void>;
  updateTodayTvl: (tvl: number) => void;
}

/**
 * Filter chart data to a window based on screen width.
 * No gap-filling — plot only what the backend returns.
 */
const filterChartDataForScreenSize = (data: ChartDataPoint[], windowWidth: number): ChartDataPoint[] => {
  if (!data?.length) return [];

  const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const daysBack = windowWidth < 1500 ? 30 : windowWidth < 1700 ? 45 : 60;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const recentData = sortedData.filter(item => new Date(item.date) >= cutoffDate);
  return recentData.length > 0 ? recentData : sortedData;
};

const scaleRatio = (val: unknown): number => {
  const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= 1e12) return n / 1e18;
  if (Math.abs(n) >= 1e6) return n / 1e6;
  if (Math.abs(n) >= 1e4) return n / 1e4;
  return n;
};

export function usePoolChartData({
  poolSlug,
  poolId,
  networkMode,
  windowWidth,
  currentFeeBps,
  isVolatilePool = false,
  isProPool = false,
  currentVolatility,
  currentAgentAdjustment,
}: UsePoolChartDataOptions): UsePoolChartDataReturn {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [feeEvents, setFeeEvents] = useState<FeeEvent[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);

  const hasFetchedForPoolRef = useRef<string | null>(null);
  const windowWidthRef = useRef(windowWidth);
  useEffect(() => { windowWidthRef.current = windowWidth; }, [windowWidth]);

  const fetchChartData = useCallback(async (force?: boolean) => {
    if (!poolSlug || !poolId) return;

    const poolKey = `${poolSlug}-${poolId}-${networkMode}`;
    // Volatile and Pro pools always refetch (no caching) to get latest fee events
    if (hasFetchedForPoolRef.current === poolKey && !force && !isVolatilePool && !isProPool) return;

    hasFetchedForPoolRef.current = poolKey;
    setIsLoadingChartData(true);

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const todayKey = new Date().toISOString().split('T')[0];

        const chartResult = await RetryUtility.fetchJson<{
          success: boolean;
          message?: string;
          data?: any[];
          feeEvents?: any[];
        }>(
          `/api/liquidity/pool-chart-data?poolId=${encodeURIComponent(poolSlug)}&days=60&network=${networkMode}`,
          {
            attempts: 2,
            baseDelay: 300,
            validate: (j) => j && typeof j.success === 'boolean',
            throwOnFailure: true,
          }
        );

        const rawData = chartResult.data!;
        if (!rawData.success) throw new Error(rawData.message || 'Failed to fetch chart data');

        const dayData = Array.isArray(rawData.data) ? rawData.data : [];
        const rawFeeEvents = Array.isArray(rawData.feeEvents) ? rawData.feeEvents : [];

        // Require minimum data quality — don't display/cache thin results
        if (dayData.length === 0 && rawFeeEvents.length < 3) throw new Error('Insufficient chart data');

        // Store raw fee events for per-event rendering
        setFeeEvents(rawFeeEvents.map((e: any) => ({
          timestamp: String(e?.timestamp ?? ''),
          // Volatile fields
          newFeeBps: e?.newFeeBps != null || e?.newFeeRateBps != null ? String(e?.newFeeBps ?? e?.newFeeRateBps ?? '0') : undefined,
          currentRatio: e?.currentRatio != null ? String(e.currentRatio) : undefined,
          newTargetRatio: e?.newTargetRatio != null ? String(e.newTargetRatio) : undefined,
          volatility: e?.volatility != null ? Number(e.volatility) : undefined,
          agentAdjustment: e?.agentAdjustment != null ? Number(e.agentAdjustment) : undefined,
          // Pro pool fields (AlphixPro)
          buyFeeBps: e?.buyFeeBps != null ? String(e.buyFeeBps) : undefined,
          sellFeeBps: e?.sellFeeBps != null ? String(e.sellFeeBps) : undefined,
          pokeType: e?.pokeType as FeeEvent['pokeType'] | undefined,
        })));

        // Build daily-bucketed chart data (used by all chart tabs)
        const dataByDate = new Map<string, { tvlUSD: number; volumeUSD: number }>();
        for (const d of dayData) {
          dataByDate.set(d.date, { tvlUSD: d.tvlUSD || 0, volumeUSD: d.volumeUSD || 0 });
        }

        const feeByDate = new Map<string, { ratio: number; ema: number; feePct: number }>();
        const evAsc = [...rawFeeEvents].sort((a: any, b: any) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

        const allDates = Array.from(new Set([
          ...dayData.map((d: { date: string }) => d.date),
          todayKey,
        ])).sort((a, b) => a.localeCompare(b));

        let ei = 0;
        // Fee chart data comes only from API fee events — never seed from live WS fee
        let curFeePct = 0;
        let curRatio = 0, curEma = 0;

        for (const dateStr of allDates) {
          const endTs = Math.floor(new Date(`${dateStr}T23:59:59Z`).getTime() / 1000);
          while (ei < evAsc.length && Number(evAsc[ei]?.timestamp || 0) <= endTs) {
            const e = evAsc[ei];
            const bps = Number(e?.newFeeBps ?? 0);
            curFeePct = Number.isFinite(bps) ? (bps / 10000) : curFeePct;
            curRatio = scaleRatio(e?.currentRatio);
            curEma = scaleRatio(e?.newTargetRatio);
            ei++;
          }
          feeByDate.set(dateStr, { ratio: curRatio, ema: curEma, feePct: curFeePct });
        }

        const merged: ChartDataPoint[] = allDates.map((dateStr) => {
          const dayInfo = dataByDate.get(dateStr);
          const feeInfo = feeByDate.get(dateStr);
          return {
            date: dateStr,
            volumeUSD: dayInfo?.volumeUSD || 0,
            tvlUSD: dayInfo?.tvlUSD || 0,
            volumeTvlRatio: feeInfo?.ratio ?? 0,
            emaRatio: feeInfo?.ema ?? 0,
            dynamicFee: feeInfo?.feePct ?? 0,
          };
        });

        setChartData(filterChartDataForScreenSize(merged, windowWidthRef.current));
        setIsLoadingChartData(false);
        return;
      } catch (error: unknown) {
        lastError = error;
        console.error(`[usePoolChartData] Attempt ${attempt}/3 failed:`, error);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
        }
      }
    }

    // All retries exhausted — don't inject a single-point fallback from live fee,
    // as it would display misleading chart data. Leave chart empty so the UI shows
    // a proper empty/error state, and clear the fetch ref so next navigation retries.
    hasFetchedForPoolRef.current = null;
    const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
    console.error('[usePoolChartData] All retries exhausted:', errorMessage);

    toast.error('Chart data failed', {
      description: errorMessage,
      action: {
        label: "Copy error",
        onClick: () => navigator.clipboard.writeText(errorMessage),
      },
    });
    setIsLoadingChartData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSlug, poolId, networkMode]);

  const updateTodayTvl = useCallback((tvl: number) => {
    if (!Number.isFinite(tvl)) return;
    const todayKey = new Date().toISOString().split('T')[0];

    setChartData(prev => {
      if (!prev?.length) return prev;
      const idx = prev.findIndex(d => d.date === todayKey);
      if (idx !== -1 && Math.abs(prev[idx].tvlUSD - tvl) > 0.01) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], tvlUSD: tvl };
        return updated;
      }
      return prev;
    });
  }, []);

  // currentFeeBps is no longer injected into chart data — it can be displayed
  // as a separate badge/label by the parent, but must not pollute the chart series.

  useEffect(() => {
    if (chartData.length > 0) {
      setChartData(prev => filterChartDataForScreenSize(prev, windowWidth));
    }
  }, [windowWidth]);

  // Volatile pools: append live fee events from WebSocket pools:metrics push
  useEffect(() => {
    if (!isVolatilePool || !currentFeeBps || !Number.isFinite(currentFeeBps)) return;
    const nowTs = String(Math.floor(Date.now() / 1000));
    setFeeEvents(prev => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      // Skip if fee and volatility haven't changed
      if (last && String(currentFeeBps) === last.newFeeBps
        && (currentVolatility ?? undefined) === last.volatility
        && (currentAgentAdjustment ?? undefined) === last.agentAdjustment) return prev;
      return [...prev, {
        timestamp: nowTs,
        newFeeBps: String(currentFeeBps),
        currentRatio: undefined,
        newTargetRatio: undefined,
        volatility: currentVolatility ?? undefined,
        agentAdjustment: currentAgentAdjustment ?? undefined,
      }];
    });
  }, [isVolatilePool, currentFeeBps, currentVolatility, currentAgentAdjustment]);

  return { chartData, feeEvents, isLoadingChartData, fetchChartData, updateTodayTvl };
}
