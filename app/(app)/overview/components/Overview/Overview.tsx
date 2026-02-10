"use client";

import { memo, useCallback, useMemo, useState } from "react";
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
import { UnifiedYieldPositionCard } from "@/components/liquidity/UnifiedYieldPositionCard";
import type { UnifiedYieldPosition } from "@/lib/liquidity/unified-yield/types";
import { Separator } from "../shared/Separator";
import { TableSectionHeader } from "../shared/TableSectionHeader";
import { ViewAllButton } from "../shared/ViewAllButton";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import { useNetwork } from "@/lib/network-context";
import { getTokenDefinitions } from "@/lib/pools-config";

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

interface OverviewProps {
  totalValue: number;
  activePositions: Position[];
  unifiedYieldPositions?: UnifiedYieldPosition[];
  priceMap: Record<string, number>;
  aprByPoolId?: Record<string, string>;
  isLoading?: boolean;
  totalPoints?: number;
  dailyPoints?: number;
  leaderboardPosition?: number | null;
}

// Constants
const MAX_POSITIONS_DISPLAYED = 5;

/**
 * Overview
 *
 * Layout Structure:
 * 1. TOP SECTION: Portfolio Chart (left) + Points Earned (right, 380px)
 * 2. Separator
 * 3. BOTTOM SECTION: Your Positions
 *
 * Spacing: gap-10 (40px) between sections
 */
export const Overview = memo(function Overview({
  totalValue,
  activePositions,
  unifiedYieldPositions = [],
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
  const isPortfolioZero = totalValue === 0 && activePositions.length === 0 && unifiedYieldPositions.length === 0;

  // Navigate to position detail page
  const handlePositionClick = useCallback((tokenId: string) => {
    router.push(`/liquidity/position/${tokenId}?from=overview`);
  }, [router]);

  // Stablecoins always priced at $1
  const STABLECOINS_USD = new Set(['USDC', 'USDS', 'atUSDC', 'atDAI']);

  // Get USD price for a symbol from priceMap (with stablecoin fallback)
  const getUsdPriceForSymbol = useCallback(
    (symbol?: string): number => {
      if (!symbol) return 0;
      // Stablecoins are always $1
      if (STABLECOINS_USD.has(symbol) || STABLECOINS_USD.has(symbol.toUpperCase())) return 1;

      // Direct lookup (case-insensitive)
      return priceMap[symbol] || priceMap[symbol.toUpperCase()] || 0;
    },
    [priceMap]
  );

  // Calculate USD value for Unified Yield position
  const getUYPositionValueUSD = useCallback(
    (position: UnifiedYieldPosition): number => {
      const amt0 = parseFloat(position.token0Amount || '0');
      const amt1 = parseFloat(position.token1Amount || '0');
      const price0 = getUsdPriceForSymbol(position.token0Symbol);
      const price1 = getUsdPriceForSymbol(position.token1Symbol);
      return amt0 * price0 + amt1 * price1;
    },
    [getUsdPriceForSymbol]
  );

  // Convert V4 positions to PositionInfo with USD values
  const v4PositionsWithValue = useMemo(() => {
    return activePositions
      .map((pos) => {
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

        if (!positionInfo) return null;

        const amt0 = parseFloat(positionInfo.currency0Amount.toExact());
        const amt1 = parseFloat(positionInfo.currency1Amount.toExact());
        const price0 = getUsdPriceForSymbol(positionInfo.currency0Amount.currency.symbol);
        const price1 = getUsdPriceForSymbol(positionInfo.currency1Amount.currency.symbol);

        return { position: positionInfo, usdValue: amt0 * price0 + amt1 * price1 };
      })
      .filter((p): p is { position: PositionInfo; usdValue: number } => p !== null);
  }, [activePositions, chainId, tokenDefinitions, getUsdPriceForSymbol]);

  // Total position count for display
  const totalPositionCount = v4PositionsWithValue.length + unifiedYieldPositions.length;

  // Unified type for display positions
  type DisplayPosition =
    | { type: 'v4'; position: PositionInfo; usdValue: number }
    | { type: 'uy'; position: UnifiedYieldPosition; usdValue: number };

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);

  // Combine all positions, sort by USD value descending
  const { allSortedPositions, hasMorePositions, totalPositionsValue, totalPages } = useMemo(() => {
    const allPositions: DisplayPosition[] = [
      ...v4PositionsWithValue.map(p => ({ type: 'v4' as const, ...p })),
      ...unifiedYieldPositions.map(pos => ({
        type: 'uy' as const,
        position: pos,
        usdValue: getUYPositionValueUSD(pos),
      })),
    ];

    // Sort by USD value descending
    const sorted = allPositions.sort((a, b) => b.usdValue - a.usdValue);
    const totalValue = sorted.reduce((sum, p) => sum + p.usdValue, 0);
    const pages = Math.ceil(sorted.length / MAX_POSITIONS_DISPLAYED);

    return {
      allSortedPositions: sorted,
      hasMorePositions: totalPositionCount > MAX_POSITIONS_DISPLAYED,
      totalPositionsValue: totalValue,
      totalPages: pages,
    };
  }, [v4PositionsWithValue, unifiedYieldPositions, getUYPositionValueUSD, totalPositionCount]);

  // Get positions for current page
  const displayedPositions = useMemo(() => {
    const startIndex = currentPage * MAX_POSITIONS_DISPLAYED;
    return allSortedPositions.slice(startIndex, startIndex + MAX_POSITIONS_DISPLAYED);
  }, [allSortedPositions, currentPage]);

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
          "xl:flex-row",
          "gap-4 xl:gap-10",
          "items-start"
        )}
      >
        {/* PORTFOLIO CHART - Left */}
        <div className="flex-1 min-w-0 flex flex-col w-full">
          <PortfolioChart className="w-full" currentPositionsValue={totalPositionsValue} isParentLoading={isLoading} />
        </div>

        {/* RIGHT COLUMN - Points Earned + Stats */}
        <div
          className="flex-shrink-0 flex flex-col gap-4 w-full xl:w-[380px]"
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
          "xl:flex-row",
          "gap-10",
          "items-start"
        )}
      >
        {/* POOLS - Left (grows to fill space) */}
        <div className="flex-1 min-w-0 flex flex-col w-full">
          <div className="flex flex-col gap-3">
            <TableSectionHeader
              title="Your Positions"
              subtitle={
                isLoading
                  ? "Loading positions..."
                  : totalPositionCount > 0
                    ? `${totalPositionCount} open position${totalPositionCount !== 1 ? "s" : ""}`
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
              ) : totalPositionCount > 0 ? (
                <div className="flex flex-col gap-3">
                  {displayedPositions.map((item, index) => (
                    <motion.div
                      key={item.type === 'v4' ? item.position.tokenId : item.position.id}
                      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
                      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                      transition={prefersReducedMotion ? undefined : {
                        delay: 0.3 + index * 0.05,
                        duration: 0.3,
                        ease: [0.25, 0.1, 0.25, 1],
                      }}
                    >
                      {item.type === 'v4' ? (
                        <PositionCardCompact
                          position={item.position}
                          valueUSD={item.usdValue}
                          onClick={() => item.position.tokenId && handlePositionClick(item.position.tokenId)}
                          poolContext={getPoolContext(item.position.poolId || '')}
                          showMenuButton={false}
                        />
                      ) : (
                        <UnifiedYieldPositionCard
                          position={item.position}
                          valueUSD={item.usdValue}
                          onClick={() => handlePositionClick(item.position.positionId)}
                          poolContext={getPoolContext(item.position.poolId)}
                        />
                      )}
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
            {hasMorePositions ? (
              <div className="flex items-center gap-1 py-2">
                {Array.from({ length: totalPages }).map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentPage(index)}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                      currentPage === index
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            ) : (
              <ViewAllButton href="/liquidity" label="View all pools" />
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - Empty placeholder to maintain layout (same width as top section) */}
        <div
          className="flex-shrink-0 hidden xl:block xl:w-[380px]"
        />
      </div>
    </div>
  );
});

export default Overview;
