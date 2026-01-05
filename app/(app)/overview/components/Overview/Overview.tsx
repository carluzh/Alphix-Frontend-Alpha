"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PointsRewardsCard } from "./PointsRewardsCard";
import { OverviewStatsTiles } from "./StatsTiles";
import { PortfolioChart } from "../Charts/PortfolioChart";
import { PositionCardCompact, PositionCardCompactLoader } from "@/components/liquidity/PositionCardCompact";
import { PositionDetailsModal } from "@/components/liquidity/PositionDetailsModal";
import { MiniTokensTable } from "./MiniTokensTable";
import { Separator } from "../shared/Separator";
import { TableSectionHeader } from "../shared/TableSectionHeader";
import { ViewAllButton } from "../shared/ViewAllButton";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import { useNetwork } from "@/lib/network-context";
import { getTokenDefinitions } from "@/lib/pools-config";

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface Position {
  positionId: string;
  poolId: string;
  owner?: string;
  token0: { symbol: string; amount: string; address?: string };
  token1: { symbol: string; amount: string; address?: string };
  liquidity?: string;
  tickLower?: number;
  tickUpper?: number;
  isInRange?: boolean;
  feeTier?: number;
  blockTimestamp?: number;
  lastTimestamp?: number;
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
}

/** Type guard for PositionInfo */
function isPositionInfo(p: PositionInfo | undefined): p is PositionInfo {
  return p !== undefined;
}

interface OverviewProps {
  totalValue: number;
  walletBalances: TokenBalance[];
  activePositions: Position[];
  priceMap: Record<string, number>;
  isLoading?: boolean;
  dailyPoints?: number;
  leaderboardPosition?: number | null;
}

// Constants
const OVERVIEW_RIGHT_COLUMN_WIDTH = 380;
const MAX_POOLS_ROWS = 5;
const MAX_TOKENS_ROWS = 8;

/**
 * Mock pointsData for demonstration of LP Incentive Rewards Badge.
 * TODO: Remove when real points data is integrated from backend.
 *
 * When pointsData.pointsApr > 0, the PointsFeeStat component will display:
 * - Pool APR + Points Badge with tooltip showing APR breakdown
 */
const MOCK_POINTS_DATA = {
  pointsApr: 8.5,
  totalApr: 15.2,
  isEligible: true,
};

/**
 * Overview
 *
 * Layout Structure:
 * 1. TOP SECTION: Portfolio Chart (left) + Points Earned (right, 320px)
 * 2. Separator
 * 3. BOTTOM SECTION: Pools (left) + Tokens (right) - same ratio as top
 *
 * Spacing: gap-10 (40px) between sections
 */
export const Overview = memo(function Overview({
  totalValue,
  walletBalances,
  activePositions,
  priceMap,
  isLoading,
  dailyPoints,
  leaderboardPosition,
}: OverviewProps) {
  const router = useRouter();
  const { networkMode, chainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const isPortfolioZero = totalValue === 0 && activePositions.length === 0;

  // Modal state for position details
  const [selectedPositionIndex, setSelectedPositionIndex] = useState<number | null>(null);
  const isModalOpen = selectedPositionIndex !== null;

  // Get USD price for a symbol from priceMap
  const getUsdPriceForSymbol = useCallback(
    (symbol?: string): number => {
      if (!symbol) return 0;
      return priceMap[symbol] || priceMap[symbol.toUpperCase()] || 0;
    },
    [priceMap]
  );

  // Calculate position value USD from PositionInfo
  const getPositionValueUSD = useCallback(
    (position: PositionInfo): number => {
      const amt0 = parseFloat(position.currency0Amount.toExact());
      const amt1 = parseFloat(position.currency1Amount.toExact());
      const symbol0 = position.currency0Amount.currency.symbol;
      const symbol1 = position.currency1Amount.currency.symbol;
      const price0 = getUsdPriceForSymbol(symbol0);
      const price1 = getUsdPriceForSymbol(symbol1);
      return amt0 * price0 + amt1 * price1;
    },
    [getUsdPriceForSymbol]
  );

  // Format token display amount (for modal)
  const formatTokenDisplayAmount = useCallback((amount: string): string => {
    const num = parseFloat(amount);
    if (isNaN(num)) return "0";
    if (num === 0) return "0";
    if (num < 0.0001) return "<0.0001";
    if (num < 1) return num.toFixed(4);
    if (num < 1000) return num.toFixed(2);
    return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }, []);

  // Close modal handler
  const handleCloseModal = useCallback(() => {
    setSelectedPositionIndex(null);
  }, []);

  // Open modal handler
  const handleOpenModal = useCallback((index: number) => {
    setSelectedPositionIndex(index);
  }, []);

  // Convert positions to PositionInfo[] - mirrors Uniswap's pattern
  const positions = useMemo(() => {
    return activePositions.slice(0, MAX_POOLS_ROWS).map((pos) => {
      const subgraphPos: SubgraphPosition = {
        positionId: pos.positionId,
        owner: pos.owner || "",
        poolId: pos.poolId,
        token0: {
          address: pos.token0.address || "",
          symbol: pos.token0.symbol,
          amount: pos.token0.amount,
        },
        token1: {
          address: pos.token1.address || "",
          symbol: pos.token1.symbol,
          amount: pos.token1.amount,
        },
        tickLower: pos.tickLower ?? 0,
        tickUpper: pos.tickUpper ?? 0,
        liquidity: pos.liquidity || "0",
        isInRange: pos.isInRange ?? true,
        token0UncollectedFees: pos.token0UncollectedFees,
        token1UncollectedFees: pos.token1UncollectedFees,
        blockTimestamp: pos.blockTimestamp,
        lastTimestamp: pos.lastTimestamp,
      };

      const token0Decimals = tokenDefinitions?.[pos.token0.symbol]?.decimals ?? 18;
      const token1Decimals = tokenDefinitions?.[pos.token1.symbol]?.decimals ?? 18;

      return parseSubgraphPosition(subgraphPos, { chainId, token0Decimals, token1Decimals });
    }).filter(isPositionInfo);
  }, [activePositions, chainId, tokenDefinitions]);

  // Selected position for modal
  const selectedPosition = selectedPositionIndex !== null ? positions[selectedPositionIndex] : null;

  // Default pool context for overview display
  const defaultPoolContext = useMemo(
    () => ({
      currentPrice: null,
      currentPoolTick: null,
      poolAPR: null,
      isLoadingPrices: isLoading ?? false,
      isLoadingPoolStates: false,
    }),
    [isLoading]
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        "gap-10",
        "mb-10"
      )}
    >
      {/* ================================================================
          TOP SECTION: Chart + Points Earned (side by side)
          ================================================================ */}
      <div
        className={cn(
          "flex flex-col",
          "min-[1200px]:flex-row",
          "gap-10",
          "items-start"
        )}
      >
        {/* PORTFOLIO CHART - Left (grows, max 720px) */}
        <div className="flex-1 min-w-0 flex flex-col">
          <PortfolioChart className="w-full max-w-[720px]" positions={activePositions} isParentLoading={isLoading} />
        </div>

        {/* RIGHT COLUMN - Points Earned + Stats (380px fixed) */}
        <div
          className="flex-shrink-0 flex flex-col gap-4"
          style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH }}
        >
          <PointsRewardsCard
            totalPoints={1847.2391}
            isLoading={isLoading}
          />
          <OverviewStatsTiles
            dailyPoints={dailyPoints}
            leaderboardPosition={leaderboardPosition}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ================================================================
          SEPARATOR
          ================================================================ */}
      <Separator />

      {/* ================================================================
          BOTTOM SECTION: Pools (left) + Tokens (right)
          Same ratio as top section
          Always shown - displays loading/empty states appropriately
          ================================================================ */}
      <div
        className={cn(
          "flex flex-col",
          "min-[1200px]:flex-row",
          "gap-10",
          "items-start"
        )}
      >
        {/* POOLS - Left (grows, max 720px) */}
        <div className="flex-1 min-w-0 flex flex-col max-w-[720px]">
          <div className="flex flex-col gap-3">
            <TableSectionHeader
              title="Pools"
              subtitle={
                isLoading
                  ? "Loading positions..."
                  : activePositions.length > 0
                    ? `${activePositions.length} open position${activePositions.length !== 1 ? "s" : ""}`
                    : "No open positions"
              }
              loading={isLoading}
            >
              {isLoading ? (
                // Shimmer loading state - mirrors Uniswap's LiquidityPositionCardLoader
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, i) => (
                    <PositionCardCompactLoader key={i} />
                  ))}
                </div>
              ) : positions.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {positions.map((position, index) => (
                    <PositionCardCompact
                      key={position.tokenId}
                      position={position}
                      valueUSD={getPositionValueUSD(position)}
                      onClick={() => handleOpenModal(index)}
                      poolContext={defaultPoolContext}
                      showMenuButton={false}
                      pointsData={MOCK_POINTS_DATA}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-6">
                  <span className="text-sm font-medium text-muted-foreground">
                    No liquidity positions
                  </span>
                </div>
              )}
            </TableSectionHeader>
            <ViewAllButton href="/liquidity" label="View all pools" />
          </div>
        </div>

        {/* TOKENS - Right (380px fixed) */}
        <div
          className="flex-shrink-0 flex flex-col"
          style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH }}
        >
          <MiniTokensTable
            tokens={walletBalances}
            maxRows={MAX_TOKENS_ROWS}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Position Details Modal */}
      {selectedPosition && (
        <PositionDetailsModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          position={selectedPosition}
          valueUSD={getPositionValueUSD(selectedPosition)}
          formatTokenDisplayAmount={formatTokenDisplayAmount}
          getUsdPriceForSymbol={getUsdPriceForSymbol}
          onRefreshPosition={() => {
            // Trigger a refresh - the parent component should handle this
          }}
          selectedPoolId={selectedPosition.poolId}
          showViewPoolButton
          onViewPool={() => {
            handleCloseModal();
            router.push(`/liquidity/${selectedPosition.poolId}`);
          }}
        />
      )}
    </div>
  );
});

export default Overview;
