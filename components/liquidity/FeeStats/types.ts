/**
 * FeeStats Type Definitions
 *
 * Mirrors Uniswap's LiquidityPositionFeeStats types from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx
 * - interface/apps/web/src/components/Liquidity/types.ts
 *
 * IMPORTANT: All interfaces match Uniswap's structure exactly.
 */

import { Dispatch, SetStateAction } from 'react';
import type { PriceOrdering } from '@/lib/liquidity/hooks/range';
import type { PositionPointsData } from '@/types';

// =============================================================================
// RANGE PROPS
// Mirrors LiquidityPositionMinMaxRangeProps from Uniswap
// =============================================================================

/**
 * Props for MinMaxRange component.
 * Mirrors Uniswap's LiquidityPositionMinMaxRangeProps exactly.
 *
 * @see interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 179-186)
 */
export interface LiquidityPositionMinMaxRangeProps {
  /** Price ordering with lower/upper bounds and base/quote currencies (optional - use pre-formatted prices instead) */
  priceOrdering?: PriceOrdering;
  /** Pool tick spacing for at-limit detection */
  tickSpacing?: number;
  /** Position lower tick */
  tickLower?: number;
  /** Position upper tick */
  tickUpper?: number;
  /** Whether prices are inverted (shows quote/base instead of base/quote) */
  pricesInverted: boolean;
  /** Setter for price inversion toggle */
  setPricesInverted: Dispatch<SetStateAction<boolean>>;
}

// =============================================================================
// FEE STATS PROPS
// Mirrors LiquidityPositionFeeStatsProps from Uniswap
// =============================================================================

/**
 * Props for LiquidityPositionFeeStats component.
 * Mirrors Uniswap's LiquidityPositionFeeStatsProps.
 *
 * @see interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 88-106)
 */
export interface LiquidityPositionFeeStatsProps extends LiquidityPositionMinMaxRangeProps {
  /** Whether the parent card is hovered (for background styling) */
  cardHovered: boolean;

  // Value displays (pre-formatted strings)
  /** Formatted position USD value (e.g., "$1,234.56") */
  formattedUsdValue?: string;
  /** Formatted fees USD value (e.g., "$12.34") */
  formattedUsdFees?: string;

  // APR data
  /** Raw APR value (for points calculation) */
  apr?: number;
  /** Formatted APR string (e.g., "12.50%") */
  formattedApr?: string;
  /** Whether APR is fallback/estimated value (show dimmed) */
  isAprFallback?: boolean;

  // Points campaign data (mirrors lpIncentiveRewardApr pattern)
  /** Points data when campaign active */
  pointsData?: PositionPointsData;

  // Token symbols for displays
  token0Symbol?: string;
  token1Symbol?: string;

  // Loading states
  /** Whether position data is loading */
  isLoading?: boolean;
  /** Whether APR is loading */
  isLoadingApr?: boolean;

  // Formatting context
  /** Pool type for decimal formatting (e.g., 'stable') */
  poolType?: string;
  /** Denomination base token for range display */
  denominationBase?: string;

  // Pre-formatted range prices (when not using priceOrdering)
  /** Pre-formatted min price string */
  formattedMinPrice?: string;
  /** Pre-formatted max price string */
  formattedMaxPrice?: string;
  /** Whether position is full range */
  isFullRange?: boolean;
}

// =============================================================================
// SUB-COMPONENT PROPS
// =============================================================================

/**
 * Props for FeeStat wrapper component.
 * Mirrors Uniswap's FeeStat: Flex flex={1} flexBasis={0}
 */
export interface FeeStatProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Props for APRFeeStat component.
 * Mirrors Uniswap's APRFeeStat function.
 *
 * @see interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx (lines 267-279)
 */
export interface APRFeeStatProps {
  /** Formatted APR string (e.g., "12.50%") or "-" */
  formattedApr: string;
  /** Whether this is a fallback/estimated APR (show dimmed) */
  isFallback?: boolean;
  /** Whether APR is loading */
  isLoading?: boolean;
}

/**
 * Extended props for MinMaxRange with formatting context.
 */
export interface MinMaxRangeProps extends LiquidityPositionMinMaxRangeProps {
  /** Pool type for decimal formatting */
  poolType?: string;
  /** Denomination base token */
  denominationBase?: string;
}
