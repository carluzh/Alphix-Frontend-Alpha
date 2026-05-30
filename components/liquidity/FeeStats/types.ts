/**
 * FeeStats Type Definitions
 *
 * Mirrors Uniswap's LiquidityPositionFeeStats types from:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionFeeStats.tsx
 * - interface/apps/web/src/components/Liquidity/types.ts
 *
 * Purely presentational props — all calculation/state lives in the parent
 * (PositionCardCompact / UnifiedYieldPositionCard).
 */

import type { PositionPointsData } from '@/types';

// =============================================================================
// FEE STATS PROPS
// Mirrors LiquidityPositionFeeStatsProps from Uniswap
// =============================================================================

/**
 * Props for LiquidityPositionFeeStats component.
 *
 * All props feed the rendered stat columns directly; the range column is driven
 * solely by the pre-formatted price strings below (the component does no SDK
 * price/tick math itself).
 */
export interface LiquidityPositionFeeStatsProps {
  /** Whether the parent card is hovered (for background styling) */
  cardHovered: boolean;

  // Value displays (pre-formatted strings)
  /** Formatted position USD value (e.g., "$1,234.56") */
  formattedUsdValue?: string;
  /** Formatted fees USD value (e.g., "$12.34") */
  formattedUsdFees?: string;
  /** Hide the fees stat entirely (for Unified Yield positions) */
  hideFees?: boolean;
  /** Custom label for the fees stat (default: "Fees") */
  feesLabel?: string;
  /** Hide range content but keep the column for spacing (Unified Yield) */
  hideRangeContent?: boolean;

  // APR data
  /** Raw APR value (for points calculation) */
  apr?: number;
  /** Formatted APR string (e.g., "12.50%") */
  formattedApr?: string;
  /** Whether APR is fallback/estimated value (show dimmed) */
  isAprFallback?: boolean;
  /** Unified Yield APR from Aave lending (for rehypo positions) */
  unifiedYieldApr?: number;

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

  // Pre-formatted range prices
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
  children?: React.ReactNode;
  className?: string;
}

/**
 * Props for APRFeeStat component.
 * Extended to support unified APR breakdown tooltip.
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
  /** Swap/Pool APR from trading fees (for tooltip breakdown) */
  swapApr?: number;
  /** Unified Yield APR from Aave lending (for tooltip breakdown) */
  unifiedYieldApr?: number;
  /** Points APR bonus (for tooltip breakdown) */
  pointsApr?: number;
  /** Token0 symbol (for tooltip) */
  token0Symbol?: string;
  /** Token1 symbol (for tooltip) */
  token1Symbol?: string;
}
