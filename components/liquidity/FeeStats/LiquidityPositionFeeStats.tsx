/**
 * LiquidityPositionFeeStats
 *
 * Main container for position fee stats display.
 * Mirrors Uniswap's LiquidityPositionFeeStats from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 88-177)
 *
 * Layout (left to right):
 * - Position value stat
 * - Fees stat
 * - Range stat (MinMaxRange)
 * - APR stat (APRFeeStat) OR Points stat (PointsFeeStat when campaign active)
 *
 * IMPORTANT: All calculation logic stays in parent component.
 * This component is purely presentational.
 */

"use client"

import React from 'react';
import { cn } from '@/lib/utils';
import { FeeStat, FeeStatLoader } from './FeeStat';
import { APRFeeStat } from './APRFeeStat';
import { MinMaxRange } from './MinMaxRange';
import { PointsFeeStat } from '@/components/liquidity/PointsCampaign';
import type { LiquidityPositionFeeStatsProps } from './types';

/**
 * LiquidityPositionFeeStats component.
 * Displays position stats in a horizontal row.
 *
 * Mirrors Uniswap's LiquidityPositionFeeStats:
 * - Layout: Flex row, gap-20, justify-between
 * - Background changes on hover (cardHovered prop)
 * - Conditional APR vs Points display (mirrors lpIncentiveRewardApr pattern)
 *
 * Tailwind mapping:
 * - gap="$gap20" → gap-5
 * - backgroundColor={cardHovered ? '$surface2Hovered' : '$surface2'} → bg-muted/50 : bg-muted/30
 * - py="$spacing8" → py-1.5
 * - px="$spacing16" → px-4
 * - borderBottomLeftRadius/Right="$rounded20" → rounded-b-lg
 *
 * @example
 * ```tsx
 * <LiquidityPositionFeeStats
 *   formattedUsdValue="$1,234.56"
 *   formattedUsdFees="$12.34"
 *   formattedApr="12.50%"
 *   isAprFallback={false}
 *   cardHovered={isHovered}
 *   pricesInverted={pricesInverted}
 *   setPricesInverted={setPricesInverted}
 *   // ... other props
 * />
 * ```
 */
export function LiquidityPositionFeeStats({
  // Value displays
  formattedUsdValue,
  formattedUsdFees,
  hideFees,
  feesLabel = 'Fees',
  hideRangeContent,
  token0Amount,
  token1Amount,

  // APR data
  apr,
  formattedApr,
  isAprFallback,
  unifiedYieldApr,

  // Points campaign
  pointsData,

  // Token symbols
  token0Symbol,
  token1Symbol,

  // Card state
  cardHovered,

  // Loading states
  isLoading,
  isLoadingApr,

  // Range props
  tickSpacing,
  tickLower,
  tickUpper,
  pricesInverted,
  setPricesInverted,

  // Formatting context
  poolType,
  denominationBase,

  // Pre-formatted range prices
  formattedMinPrice,
  formattedMaxPrice,
  isFullRange,
}: LiquidityPositionFeeStatsProps) {
  return (
    <div className={cn(
      // Layout - mirrors Flex row gap="$gap20" justifyContent="space-between"
      // Increased padding for larger stat bar
      "flex items-center justify-between gap-5 py-4 px-4 rounded-b-lg transition-colors",
      // Background - mirrors backgroundColor={cardHovered ? '$surface2Hovered' : '$surface2'}
      cardHovered ? "bg-muted/50" : "bg-muted/30"
    )}>
      {/* Position Value - mirrors first FeeStat */}
      <FeeStat>
        {isLoading ? (
          <FeeStatLoader />
        ) : (
          <>
            <span className="text-sm font-medium font-mono">
              {formattedUsdValue || '-'}
            </span>
            <span className="text-xs text-muted-foreground">Position</span>
          </>
        )}
      </FeeStat>

      {/* Fees - mirrors second FeeStat (hidden for Unified Yield positions) */}
      {!hideFees && (
        <FeeStat>
          {isLoading ? (
            <FeeStatLoader />
          ) : (
            <>
              <span className={cn(
                "text-sm font-medium font-mono",
                formattedUsdFees === '$0.00' && "text-white/50"
              )}>
                {formattedUsdFees || '-'}
              </span>
              <span className="text-xs text-muted-foreground">{feesLabel}</span>
            </>
          )}
        </FeeStat>
      )}

      {/* Range - uses pre-formatted prices (hidden for Unified Yield positions) */}
      {!hideFees && !hideRangeContent && (
        <MinMaxRange
          tickSpacing={tickSpacing}
          tickLower={tickLower}
          tickUpper={tickUpper}
          pricesInverted={pricesInverted}
          setPricesInverted={setPricesInverted}
          poolType={poolType}
          denominationBase={denominationBase}
          formattedMinPrice={formattedMinPrice}
          formattedMaxPrice={formattedMaxPrice}
          isFullRange={isFullRange}
        />
      )}

      {/* Empty range placeholder for Unified Yield - maintains layout spacing */}
      {!hideFees && hideRangeContent && <FeeStat />}

      {/* APR - Conditional: PointsFeeStat or APRFeeStat */}
      {/* Both now use unified APRBreakdownTooltip with Swap APR, Unified Yield, Points */}
      {pointsData?.pointsApr ? (
        <PointsFeeStat
          poolApr={apr}
          pointsApr={pointsData.pointsApr}
          totalApr={pointsData.totalApr}
          unifiedYieldApr={unifiedYieldApr ?? pointsData.unifiedYieldApr}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
        />
      ) : (
        <APRFeeStat
          formattedApr={formattedApr || '-'}
          isFallback={isAprFallback}
          isLoading={isLoadingApr}
          swapApr={apr}
          unifiedYieldApr={unifiedYieldApr ?? 0}
          pointsApr={0}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
        />
      )}
    </div>
  );
}
