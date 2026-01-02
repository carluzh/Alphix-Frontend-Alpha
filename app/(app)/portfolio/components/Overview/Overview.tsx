"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { PointsRewardsCard } from "./PointsRewardsCard";
import { PortfolioChart } from "./PortfolioChart";
import { OverviewActionTiles } from "./ActionTiles";
import { OverviewStatsTiles } from "./StatsTiles";
import { PortfolioOverviewTables } from "./OverviewTables";
import { Separator } from "../shared/Separator";

// Constants matching Uniswap
const OVERVIEW_RIGHT_COLUMN_WIDTH = 360;

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface Position {
  positionId: string;
  poolId?: string;
  token0?: { symbol: string; amount: string };
  token1?: { symbol: string; amount: string };
  isInRange?: boolean;
  feeTier?: number;
}

interface ActivityItem {
  id: string;
  type: string;
  timestamp: number;
  token0?: { symbol: string; amount: string };
  token1?: { symbol: string; amount: string };
  totalUsdValue?: number;
}

interface ChartDataPoint {
  time: number;
  value: number;
}

interface PortfolioOverviewProps {
  totalValue: number;
  walletBalances: TokenBalance[];
  activePositions: Position[];
  activities: ActivityItem[];
  priceMap: Record<string, number>;
  swapCount?: number;
  totalVolumeUSD?: number;
  isLoading?: boolean;
  chartData?: ChartDataPoint[];
  isChartLoading?: boolean;
  chartError?: Error | null;
  selectedPeriod?: string;
  onPeriodChange?: (period: any) => void;
}

/**
 * PortfolioOverview - matches Uniswap's Overview.tsx exactly
 *
 * Layout Structure:
 * 1. Top Section: Chart + Actions/Stats (row, stacks on xl)
 *    - Left: Portfolio Chart (grows)
 *    - Right: Action Tiles + Stats Tiles (360px fixed)
 * 2. Separator
 * 3. Bottom Section: Mini Tables (row, column-reverse on xl)
 *    - Left: Tokens + Pools (grows)
 *    - Right: Activity (360px fixed)
 *
 * Spacing:
 * - Main gap: $spacing40 (40px)
 * - Actions/Stats gap: $spacing16 (16px)
 * - Bottom margin: $spacing40 (40px)
 */
export const PortfolioOverview = memo(function PortfolioOverview({
  totalValue,
  walletBalances,
  activePositions,
  activities,
  priceMap,
  swapCount = 0,
  totalVolumeUSD = 0,
  isLoading,
  chartData,
  isChartLoading,
  chartError,
  selectedPeriod,
  onPeriodChange,
}: PortfolioOverviewProps) {
  const isPortfolioZero = totalValue === 0 && activePositions.length === 0;

  return (
    <div
      className={cn(
        // Layout
        "flex flex-col",
        // Gap: $spacing40 = 40px
        "gap-10",
        // Bottom margin: $spacing40 = 40px
        "mb-10"
      )}
    >
      {/* ================================================================
          POINTS REWARDS CARD - Top (Uniswap-style)
          ================================================================ */}
      <PointsRewardsCard
        totalPoints={1847.2391}
        isLoading={isLoading}
      />

      {/* ================================================================
          CHART + ACTIONS SECTION
          Row by default, column on smaller screens (md and below)
          Gap: 40px ($spacing40)
          ================================================================ */}
      <div className="flex flex-col md:flex-row gap-10">
        {/* PORTFOLIO CHART - Left (grows to fill) */}
        <PortfolioChart
          portfolioTotalBalanceUSD={totalValue}
          isPortfolioZero={isPortfolioZero}
          chartData={chartData}
          isPending={isChartLoading || isLoading}
          error={chartError}
          selectedPeriod={selectedPeriod as any}
          onPeriodChange={onPeriodChange}
          className="flex-1 min-w-0"
        />

        {/* ACTIONS + STATS CONTAINER - Right (360px fixed on desktop) */}
        <div
          className="flex-shrink-0 w-full md:w-[360px] flex flex-col gap-4"
          style={{
            minHeight: isPortfolioZero ? 120 : undefined,
          }}
        >
          {isPortfolioZero ? (
            // Empty wallet state
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl border border-sidebar-border bg-container/50 h-full">
              <h3 className="text-lg font-medium text-foreground mb-2">
                Get started
              </h3>
              <p className="text-sm text-muted-foreground text-center">
                Swap, buy, or receive tokens to start building your portfolio.
              </p>
            </div>
          ) : (
            <>
              {/* Action Tiles */}
              <OverviewActionTiles />

              {/* Stats Tiles */}
              <OverviewStatsTiles
                swapCount={swapCount}
                totalVolumeUSD={totalVolumeUSD}
                isLoading={isLoading}
              />
            </>
          )}
        </div>
      </div>

      {/* ================================================================
          SEPARATOR
          ================================================================ */}
      <Separator />

      {/* ================================================================
          BOTTOM SECTION: Mini Tables
          Only shown when portfolio is not empty
          ================================================================ */}
      {!isPortfolioZero && (
        <PortfolioOverviewTables
          walletBalances={walletBalances}
          activePositions={activePositions}
          activities={activities}
          priceMap={priceMap}
          isLoading={isLoading}
        />
      )}
    </div>
  );
});

export default PortfolioOverview;
