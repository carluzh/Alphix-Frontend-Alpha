"use client";

import { useMemo } from "react";
import { PortfolioOverview } from "./components/Overview/Overview";
import { usePortfolioPageData } from "./hooks/usePortfolioPageData";
import { usePortfolioChart, formatChartDataForRecharts } from "./hooks/usePortfolioChart";

/**
 * Portfolio Overview Page
 *
 * Default route: /portfolio
 * Shows the Overview tab with:
 * - Portfolio chart
 * - Action tiles (Swap, Send, More)
 * - Stats tiles (Swaps this week, Volume)
 * - Mini tables (Tokens, Pools, Activity)
 */
export default function PortfolioPage() {
  const {
    totalValue,
    walletBalances,
    activePositions,
    activities,
    priceMap,
    swapCount,
    totalVolumeUSD,
    isLoading,
  } = usePortfolioPageData();

  // Chart data from usePortfolioChart hook
  const {
    chartData,
    isLoading: isChartLoading,
    error: chartError,
    selectedPeriod,
    setSelectedPeriod,
  } = usePortfolioChart(totalValue);

  // Convert chart data to recharts format
  const formattedChartData = useMemo(() => {
    return formatChartDataForRecharts(chartData);
  }, [chartData]);

  return (
    <PortfolioOverview
      totalValue={totalValue}
      walletBalances={walletBalances}
      activePositions={activePositions}
      activities={activities}
      priceMap={priceMap}
      swapCount={swapCount}
      totalVolumeUSD={totalVolumeUSD}
      isLoading={isLoading}
      chartData={formattedChartData}
      isChartLoading={isChartLoading}
      chartError={chartError}
      selectedPeriod={selectedPeriod}
      onPeriodChange={setSelectedPeriod}
    />
  );
}
