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
}

interface UsePoolChartDataOptions {
  poolId: string;
  subgraphId: string;
  networkMode: string;
  windowWidth: number;
}

interface UsePoolChartDataReturn {
  chartData: ChartDataPoint[];
  isLoadingChartData: boolean;
  fetchChartData: (force?: boolean) => Promise<void>;
  updateTodayTvl: (tvl: number) => void;
}

/**
 * Process chart data for screen size - determines how many days to show
 * and fills in gaps with interpolated/zero values.
 */
const processChartDataForScreenSize = (data: ChartDataPoint[], windowWidth: number): ChartDataPoint[] => {
  if (!data?.length) return [];

  const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const daysBack = windowWidth < 1500 ? 30 : windowWidth < 1700 ? 45 : 60;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const recentData = sortedData.filter(item => new Date(item.date) >= cutoffDate);
  if (!recentData.length) return sortedData;

  const filledData: ChartDataPoint[] = [];
  const startDate = new Date(recentData[0].date);
  const endDate = new Date(recentData[recentData.length - 1].date);
  let currentDate = new Date(startDate);
  let lastTvl = 0;

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const existingData = recentData.find(item => item.date === dateStr);

    if (existingData) {
      filledData.push(existingData);
      lastTvl = existingData.tvlUSD;
    } else {
      let dynamicFeeValue = 0;
      if (lastTvl > 0) {
        const lastDataPoint = filledData[filledData.length - 1];
        if (lastDataPoint?.dynamicFee > 0) dynamicFeeValue = lastDataPoint.dynamicFee;
      }
      filledData.push({
        date: dateStr,
        volumeUSD: 0,
        tvlUSD: lastTvl,
        volumeTvlRatio: 0,
        emaRatio: 0,
        dynamicFee: dynamicFeeValue,
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Pad at the beginning if we don't have enough days
  if (filledData.length > 0 && filledData.length < daysBack) {
    const daysToAdd = daysBack - filledData.length;
    const oldestDate = new Date(filledData[0].date);
    const emptyDays: ChartDataPoint[] = [];

    for (let i = 1; i <= daysToAdd; i++) {
      const emptyDate = new Date(oldestDate);
      emptyDate.setDate(emptyDate.getDate() - i);
      emptyDays.unshift({
        date: emptyDate.toISOString().split('T')[0],
        volumeUSD: 0,
        tvlUSD: 0,
        volumeTvlRatio: 0,
        emaRatio: 0,
        dynamicFee: 0,
      });
    }

    return [...emptyDays, ...filledData];
  }

  return filledData;
};

/**
 * Scale ratio values that come in various formats from the API.
 */
const scaleRatio = (val: unknown): number => {
  const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) >= 1e12) return n / 1e18;
  if (Math.abs(n) >= 1e6) return n / 1e6;
  if (Math.abs(n) >= 1e4) return n / 1e4;
  return n;
};

export function usePoolChartData({
  poolId,
  subgraphId,
  networkMode,
  windowWidth,
}: UsePoolChartDataOptions): UsePoolChartDataReturn {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);

  // Refs to prevent redundant fetches and avoid useCallback identity changes
  const hasFetchedForPoolRef = useRef<string | null>(null);
  const windowWidthRef = useRef(windowWidth);
  useEffect(() => { windowWidthRef.current = windowWidth; }, [windowWidth]);

  const fetchChartData = useCallback(async (force?: boolean) => {
    if (!poolId || !subgraphId) return;

    // Guard against redundant fetches - poolKey auto-resets when pool changes
    const poolKey = `${poolId}-${subgraphId}`;
    if (hasFetchedForPoolRef.current === poolKey && !force) return;

    hasFetchedForPoolRef.current = poolKey;
    setIsLoadingChartData(true);

    try {
      const targetDays = 60;
      const todayKey = new Date().toISOString().split('T')[0];

      const chartResult = await RetryUtility.fetchJson<{
        success: boolean;
        message?: string;
        data?: any[];
        feeEvents?: any[];
      }>(
        `/api/liquidity/pool-chart-data?poolId=${encodeURIComponent(poolId)}&days=${targetDays}`,
        {
          attempts: 2,
          baseDelay: 300,
          // Only validate response structure, handle success/failure separately
          validate: (j) => j && typeof j.success === 'boolean',
          throwOnFailure: true,
        }
      );

      const rawData = chartResult.data!;

      // Check if API returned an error
      if (!rawData.success) {
        throw new Error(rawData.message || 'Failed to fetch chart data from backend');
      }

      // Check if we have data
      if (!Array.isArray(rawData.data) || rawData.data.length === 0) {
        throw new Error('No chart data available for this pool');
      }
      const dayData = Array.isArray(rawData.data) ? rawData.data : [];
      const feeEvents = Array.isArray(rawData.feeEvents) ? rawData.feeEvents : [];

      // Build date-indexed maps
      const dataByDate = new Map<string, { tvlUSD: number; volumeUSD: number }>();
      for (const d of dayData) {
        dataByDate.set(d.date, { tvlUSD: d.tvlUSD || 0, volumeUSD: d.volumeUSD || 0 });
      }

      // Map fee events to per-day overlays
      const feeByDate = new Map<string, { ratio: number; ema: number; feePct: number }>();
      const evAsc = [...feeEvents].sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

      // Get all dates
      const allDates = Array.from(new Set([
        ...dayData.map((d: { date: string }) => d.date),
        todayKey,
      ])).sort((a, b) => a.localeCompare(b));

      // Process fee events for each date
      let ei = 0, curFeePct = 0, curRatio = 0, curEma = 0;
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

      // Build final merged chart data
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

      setChartData(processChartDataForScreenSize(merged, windowWidthRef.current));
    } catch (error: unknown) {
      hasFetchedForPoolRef.current = null;
      console.error('Failed to fetch chart data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error('Chart Data Failed', {
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage),
        },
      });
    } finally {
      setIsLoadingChartData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, subgraphId]);

  const updateTodayTvl = useCallback((tvl: number) => {
    if (!Number.isFinite(tvl)) return;

    const todayKey = new Date().toISOString().split('T')[0];

    setChartData(prev => {
      if (!prev || prev.length === 0) return prev;

      const todayIndex = prev.findIndex(d => d.date === todayKey);
      if (todayIndex !== -1 && Math.abs(prev[todayIndex].tvlUSD - tvl) > 0.01) {
        const updated = [...prev];
        updated[todayIndex] = { ...updated[todayIndex], tvlUSD: tvl };
        return updated;
      }
      return prev;
    });
  }, []);

  // Re-process chart data when window width changes
  useEffect(() => {
    if (chartData.length > 0) {
      setChartData(prev => processChartDataForScreenSize(prev, windowWidth));
    }
  }, [windowWidth]);

  return {
    chartData,
    isLoadingChartData,
    fetchChartData,
    updateTodayTvl,
  };
}
