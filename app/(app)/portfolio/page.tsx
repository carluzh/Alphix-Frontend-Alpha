"use client";

import { PortfolioOverview } from "./components/Overview/Overview";
import { usePortfolioPageData } from "./hooks/usePortfolioPageData";

/**
 * Portfolio Overview Page
 *
 * Default route: /portfolio
 * Shows the Overview tab with:
 * - Portfolio chart (with demo wallet when disconnected)
 * - Points earned card
 * - Mini tables (Pools, Tokens)
 */
export default function PortfolioPage() {
  const {
    totalValue,
    walletBalances,
    activePositions,
    priceMap,
    isLoading,
  } = usePortfolioPageData();

  return (
    <PortfolioOverview
      totalValue={totalValue}
      walletBalances={walletBalances}
      activePositions={activePositions}
      priceMap={priceMap}
      isLoading={isLoading}
    />
  );
}
