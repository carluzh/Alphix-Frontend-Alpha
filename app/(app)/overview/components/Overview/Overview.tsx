"use client";

import { memo, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { PointsRewardsCard } from "./PointsRewardsCard";
import { OverviewStatsTiles } from "./StatsTiles";

const PortfolioChart = dynamic(() => import("../Charts/PortfolioChart").then(mod => mod.PortfolioChart), { ssr: false });
import { PositionCardCompact, PositionCardCompactLoader } from "@/components/liquidity/PositionCardCompact";
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
  aprByPoolId?: Record<string, string>;
  isLoading?: boolean;
  totalPoints?: number;
  dailyPoints?: number;
  leaderboardPosition?: number | null;
}

// Constants
const OVERVIEW_RIGHT_COLUMN_WIDTH = 380;
const MAX_POOLS_ROWS = 5;
const MAX_TOKENS_ROWS = 8;


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
  aprByPoolId,
  isLoading,
  totalPoints,
  dailyPoints,
  leaderboardPosition,
}: OverviewProps) {
  const router = useRouter();
  const { networkMode, chainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const isPortfolioZero = totalValue === 0 && activePositions.length === 0;

  // Navigate to position detail page
  const handlePositionClick = useCallback((tokenId: string) => {
    router.push(`/liquidity/position/${tokenId}`);
  }, [router]);

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


  // Convert positions to PositionInfo[] - mirrors Uniswap's pattern
  // Sort by USD value descending before taking top positions
  const positions = useMemo(() => {
    // First convert all positions to get their values
    const positionsWithValue = activePositions.map((pos) => {
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

      const positionInfo = parseSubgraphPosition(subgraphPos, { chainId, token0Decimals, token1Decimals });

      // Calculate USD value for sorting
      let usdValue = 0;
      if (positionInfo) {
        const amt0 = parseFloat(positionInfo.currency0Amount.toExact());
        const amt1 = parseFloat(positionInfo.currency1Amount.toExact());
        const symbol0 = positionInfo.currency0Amount.currency.symbol;
        const symbol1 = positionInfo.currency1Amount.currency.symbol;
        const price0 = getUsdPriceForSymbol(symbol0);
        const price1 = getUsdPriceForSymbol(symbol1);
        usdValue = amt0 * price0 + amt1 * price1;
      }

      return { positionInfo, usdValue };
    });

    // Sort by USD value descending, then take top MAX_POOLS_ROWS
    return positionsWithValue
      .filter((p): p is { positionInfo: PositionInfo; usdValue: number } => p.positionInfo !== undefined)
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, MAX_POOLS_ROWS)
      .map(p => p.positionInfo);
  }, [activePositions, chainId, tokenDefinitions, getUsdPriceForSymbol]);

  // Calculate total positions value for the chart's "live now" point
  const totalPositionsValue = useMemo(() => {
    return positions.reduce((sum, pos) => sum + getPositionValueUSD(pos), 0);
  }, [positions, getPositionValueUSD]);

  // Get pool context for a position (with APR from aprByPoolId)
  const getPoolContext = useCallback(
    (poolId: string) => {
      // Parse APR string (e.g., "12.34%" or "N/A") to number
      const aprString = aprByPoolId?.[poolId.toLowerCase()];
      let poolAPR: number | null = null;
      if (aprString && aprString !== "N/A") {
        const parsed = parseFloat(aprString.replace('%', ''));
        if (!isNaN(parsed)) poolAPR = parsed;
      }
      return {
        currentPrice: null,
        currentPoolTick: null,
        poolAPR,
        isLoadingPrices: isLoading ?? false,
        isLoadingPoolStates: false,
      };
    },
    [aprByPoolId, isLoading]
  );

  const prefersReducedMotion = useReducedMotion();

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
          <PortfolioChart className="w-full max-w-[720px]" currentPositionsValue={totalPositionsValue} isParentLoading={isLoading} />
        </div>

        {/* RIGHT COLUMN - Points Earned + Stats (380px fixed) */}
        <div
          className="flex-shrink-0 flex flex-col gap-4"
          style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH }}
        >
          <PointsRewardsCard
            totalPoints={totalPoints}
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
        {/* POOLS - Left (grows to fill space) */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex flex-col gap-3">
            <TableSectionHeader
              title="Your Positions"
              subtitle={
                isLoading
                  ? "Loading positions..."
                  : activePositions.length > 0
                    ? `${activePositions.length} open position${activePositions.length !== 1 ? "s" : ""}`
                    : "No open positions"
              }
              loading={isLoading}
              action={
                <Button
                  asChild
                  className="h-10 px-4 gap-2 bg-button-primary hover-button-primary text-sidebar-primary font-semibold rounded-md transition-all active:scale-[0.98]"
                >
                  <Link href="/liquidity/add?from=overview">
                    <Plus className="h-4 w-4" strokeWidth={2.5} />
                    New position
                  </Link>
                </Button>
              }
            >
              {isLoading ? (
                // Loading state
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, i) => (
                    <PositionCardCompactLoader key={i} />
                  ))}
                </div>
              ) : positions.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {positions.map((position, index) => (
                    <motion.div
                      key={position.tokenId}
                      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
                      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                      transition={prefersReducedMotion ? undefined : {
                        delay: 0.3 + index * 0.05,
                        duration: 0.3,
                        ease: [0.25, 0.1, 0.25, 1],
                      }}
                    >
                      <PositionCardCompact
                        position={position}
                        valueUSD={getPositionValueUSD(position)}
                        onClick={() => position.tokenId && handlePositionClick(position.tokenId)}
                        poolContext={getPoolContext(position.poolId || '')}
                        showMenuButton={false}
                      />
                    </motion.div>
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
    </div>
  );
});

export default Overview;
