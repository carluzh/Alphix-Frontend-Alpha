"use client";

import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { PositionCardCompact } from "@/components/liquidity/PositionCardCompact";
import { PositionSkeleton } from "@/components/liquidity/PositionSkeleton";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { PositionInfo } from "@/lib/uniswap/liquidity";
import type { PoolConfig, PoolStateData } from "../../hooks";

interface PoolDetailPositionsProps {
  poolConfig: PoolConfig | null;
  poolState: PoolStateData;
  poolAPR: number;
  isLoadingPrices: boolean;
  userPositions: ProcessedPosition[];
  isLoadingPositions: boolean;
  isDerivingNewPosition: boolean;
  priceMap: Record<string, number>;
  onPositionClick: (position: ProcessedPosition) => void;
  onAddLiquidity: () => void;
  getPositionInfo: (position: ProcessedPosition) => PositionInfo | undefined;
  convertTickToPrice: (
    tick: number,
    currentPoolTick: number | null,
    currentPrice: string | null,
    baseTokenForPriceDisplay: string,
    token0Symbol: string,
    token1Symbol: string
  ) => string;
  calculatePositionUsd: (position: ProcessedPosition) => number;
  getFeesForPosition: (positionId: string, position?: ProcessedPosition) => {
    positionId: string;
    amount0: string;
    amount1: string;
    totalValueUSD?: number;
  } | null;
}

/**
 * Pool positions list component.
 * Displays user's liquidity positions for the current pool.
 */
export const PoolDetailPositions = memo(function PoolDetailPositions({
  poolConfig,
  poolState,
  poolAPR,
  isLoadingPrices,
  userPositions,
  isLoadingPositions,
  isDerivingNewPosition,
  priceMap,
  onPositionClick,
  onAddLiquidity,
  getPositionInfo,
  convertTickToPrice,
  calculatePositionUsd,
  getFeesForPosition,
}: PoolDetailPositionsProps) {
  const token0Symbol = poolConfig?.tokens?.[0]?.symbol || "";
  const token1Symbol = poolConfig?.tokens?.[1]?.symbol || "";
  const prefersReducedMotion = useReducedMotion();

  const hasPositions = userPositions.length > 0 || isDerivingNewPosition;

  // Pool context for position cards - matches PositionCardCompact interface
  const poolContext = useMemo(() => ({
    currentPoolTick: poolState.currentPoolTick,
    currentPrice: poolState.currentPrice,
    poolAPR: poolAPR > 0 ? poolAPR : null,
    isLoadingPrices,
    isLoadingPoolStates: false, // Pool state is always loaded at this point
  }), [poolState.currentPoolTick, poolState.currentPrice, poolAPR, isLoadingPrices]);

  if (isLoadingPositions && userPositions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {/* Horizontal divider */}
        <div className="h-px bg-sidebar-border/60" />

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your Positions</h2>
        </div>
        {/* Full-width cards (single column) */}
        <div className="flex flex-col gap-3">
          <PositionSkeleton
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />
          <PositionSkeleton
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />
        </div>
      </div>
    );
  }

  if (!hasPositions) {
    return (
      <div className="flex flex-col gap-4">
        {/* Horizontal divider */}
        <div className="h-px bg-sidebar-border/60" />

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your Positions</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border border-dashed border-sidebar-border/60 bg-muted/5">
          <p className="text-muted-foreground text-sm">
            You don&apos;t have any positions in this pool yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal divider */}
      <div className="h-px bg-sidebar-border/60" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Your Positions</h2>
      </div>

      {/* Positions List - Full width cards */}
      <div className="flex flex-col gap-3">
        {/* New position skeleton (while deriving) */}
        {isDerivingNewPosition && (
          <PositionSkeleton
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />
        )}

        {/* Existing positions */}
        {userPositions.map((position, index) => {
          const positionInfo = getPositionInfo(position);
          const valueUSD = calculatePositionUsd(position);

          // Only render if positionInfo is available (required by PositionCardCompact)
          if (!positionInfo) return null;

          const card = (
            <PositionCardCompact
              key={position.positionId}
              position={positionInfo}
              valueUSD={valueUSD}
              poolContext={poolContext}
              poolType={poolConfig?.type}
              onClick={() => onPositionClick(position)}
              blockTimestamp={position.blockTimestamp}
              lastTimestamp={position.lastTimestamp}
              isOptimisticallyUpdating={position.isOptimisticallyUpdating}
            />
          );

          if (prefersReducedMotion) {
            return <div key={position.positionId}>{card}</div>;
          }

          return (
            <motion.div
              key={position.positionId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.1 + index * 0.05,
                duration: 0.3,
                ease: [0.25, 0.1, 0.25, 1],
              }}
            >
              {card}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
});
