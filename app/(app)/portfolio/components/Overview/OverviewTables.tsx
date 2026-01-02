"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { MiniTokensTable } from "./MiniTokensTable";
import { MiniPoolsTable } from "./MiniPoolsTable";
import { MiniActivityTable } from "./MiniActivityTable";

// Constants matching Uniswap
const OVERVIEW_RIGHT_COLUMN_WIDTH = 360;
const MAX_TOKENS_ROWS = 8;
const MAX_POOLS_ROWS = 5;
const MAX_ACTIVITY_ROWS = 5;

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

interface PortfolioOverviewTablesProps {
  walletBalances: TokenBalance[];
  activePositions: Position[];
  activities: ActivityItem[];
  priceMap: Record<string, number>;
  isLoading?: boolean;
}

/**
 * PortfolioOverviewTables - matches Uniswap's OverviewTables.tsx exactly
 *
 * Layout:
 * - Flex row, gap="$spacing40" (40px)
 * - Left column: Tokens + Pools (grows, shrinks)
 * - Right column: Activity (360px fixed)
 * - On XL breakpoint: column-reverse
 */
export const PortfolioOverviewTables = memo(function PortfolioOverviewTables({
  walletBalances,
  activePositions,
  activities,
  priceMap,
  isLoading,
}: PortfolioOverviewTablesProps) {
  return (
    <div
      className={cn(
        // Layout: row on desktop, column-reverse on mobile
        "flex flex-row xl:flex-col-reverse",
        // Gap
        "gap-10",
        // Full width
        "w-full",
        // Alignment
        "items-start justify-between"
      )}
    >
      {/* Left Column: Tokens + Pools (grows, shrinks) */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 xl:w-full">
        <MiniTokensTable
          tokens={walletBalances}
          maxRows={MAX_TOKENS_ROWS}
          isLoading={isLoading}
        />
        <MiniPoolsTable
          positions={activePositions}
          priceMap={priceMap}
          maxRows={MAX_POOLS_ROWS}
          isLoading={isLoading}
        />
      </div>

      {/* Right Column: Activity (360px fixed) */}
      <div
        className="flex-shrink-0 flex flex-col gap-10 xl:w-full"
        style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH }}
      >
        <MiniActivityTable
          activities={activities}
          maxRows={MAX_ACTIVITY_ROWS}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
});

export default PortfolioOverviewTables;
