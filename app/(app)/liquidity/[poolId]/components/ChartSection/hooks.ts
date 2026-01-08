"use client";

import { useState, useMemo } from "react";

/**
 * Chart types available in the pool detail page.
 * Simplified to 3 main chart types: Fee (default), Volume, TVL.
 * Fee chart shows all dynamic fee data (Activity, Target, Fee) with dual y-axis.
 */
export enum ChartType {
  FEE = "fee",
  VOLUME = "volume",
  TVL = "tvl",
}

interface UsePDPChartStateReturn {
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
}

/**
 * Hook for managing chart state in the pool detail page.
 * Simplified to 3 chart types matching PortfolioChart pattern.
 */
export function usePDPChartState(): UsePDPChartStateReturn {
  const [chartType, setChartType] = useState<ChartType>(ChartType.FEE);

  return {
    chartType,
    setChartType,
  };
}

/**
 * Chart configuration for Recharts.
 */
export const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "#404040" },
  tvl: { label: "TVL", color: "#404040" },
  volumeUSD: { label: "Volume", color: "#404040" },
  tvlUSD: { label: "TVL", color: "#404040" },
  // Fee chart lines
  volumeTvlRatio: { label: "Activity", color: "hsl(var(--chart-3))" },
  emaRatio: { label: "Target", color: "hsl(var(--chart-2))" },
  dynamicFee: { label: "Fee", color: "#e85102" },
};

export type ChartConfigKey = keyof typeof chartConfig;
