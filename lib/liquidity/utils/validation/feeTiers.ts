/**
 * Fee Tiers - Utilities for fee tier management and dynamic fee visualization
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/utils/feeTiers.ts
 *
 * Extended for Alphix with dynamic fee algorithm visualization support.
 * All Alphix pools use dynamic fees managed by hooks.
 */

import { Percent } from '@uniswap/sdk-core';

import type { FeeData } from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Dynamic fee flag value (0x800000)
 * When a pool has this fee value, it indicates dynamic fees managed by hooks.
 */
export const DYNAMIC_FEE_AMOUNT = 8388608;

/**
 * Default tick spacing for dynamic fee pools
 */
export const DEFAULT_TICK_SPACING = 60;

/**
 * Default dynamic fee data
 */
export const DYNAMIC_FEE_DATA: FeeData = {
  isDynamic: true,
  feeAmount: DYNAMIC_FEE_AMOUNT,
  tickSpacing: DEFAULT_TICK_SPACING,
};

/**
 * Maximum decimals for fee tier display
 */
export const MAX_FEE_TIER_DECIMALS = 4;

/**
 * Maximum fee tier value (99.9999%)
 */
const MAX_FEE_TIER_VALUE = 99.9999;

/**
 * Basis points base (10000 = 100%)
 */
export const BIPS_BASE = 10000;

// =============================================================================
// FEE TIER TYPES
// =============================================================================

export interface FeeTierData {
  /** Fee configuration */
  fee: FeeData;
  /** Formatted fee string for display */
  formattedFee: string;
  /** Total liquidity in USD */
  totalLiquidityUsd: number;
  /** Percentage of total pool liquidity */
  percentage: Percent;
  /** Whether this fee tier has been created */
  created: boolean;
  /** TVL string */
  tvl: string;
  /** Boosted APR (if applicable) */
  boostedApr?: number;
}

export interface DynamicFeeVisualization {
  /** Current fee rate in basis points */
  currentFeeBps: number;
  /** Base/initial fee rate in basis points */
  baseFeeBps: number;
  /** Target ratio (1e18 scale) */
  targetRatio: string;
  /** Current ratio (1e18 scale) */
  currentRatio: string;
  /** Fee adjustment percentage from base */
  feeAdjustmentPercent: number;
  /** Whether fee is currently discounted */
  isDiscounted: boolean;
  /** Description of current fee state */
  description: string;
  /** Savings compared to static fee (if discounted) */
  savingsPercent?: number;
}

export interface PoolTypeInfo {
  /** Pool type name */
  type: 'Standard' | 'Stable' | string;
  /** Description of pool type */
  description: string;
  /** Typical tick spacing for this type */
  typicalTickSpacing: number;
  /** Whether this type is suitable for stable pairs */
  isStablePair: boolean;
}

// =============================================================================
// FEE VALIDATION & FORMATTING
// =============================================================================

/**
 * Validate fee tier input and clamp to max value.
 */
export function validateFeeTier(feeTier: string): string {
  const numValue = parseFloat(feeTier);
  if (isNaN(numValue)) return '0';
  if (numValue > MAX_FEE_TIER_VALUE) {
    return MAX_FEE_TIER_VALUE.toString();
  }
  return feeTier;
}

/**
 * Calculate tick spacing from fee amount.
 * Tick spacing must be a whole number >= 1.
 */
export function calculateTickSpacingFromFeeAmount(feeAmount: number): number {
  return Math.max(Math.round((2 * feeAmount) / 100), 1);
}

/**
 * Format fee amount as percentage string.
 * @param feeAmount - Fee in basis points (e.g., 3000 = 0.3%)
 * @param maxDecimals - Maximum decimal places
 */
export function formatFeePercent(
  feeAmount: number,
  maxDecimals: number = MAX_FEE_TIER_DECIMALS
): string {
  const percent = feeAmount / BIPS_BASE;
  return `${percent.toFixed(maxDecimals).replace(/\.?0+$/, '')}%`;
}

/**
 * Format fee for display, handling dynamic fees.
 */
export function formatFeeForDisplay(
  feeData: FeeData,
  dynamicFeeLabel: string = 'Dynamic'
): string {
  if (isDynamicFeeTier(feeData)) {
    return dynamicFeeLabel;
  }
  return formatFeePercent(feeData.feeAmount);
}

// =============================================================================
// FEE TIER KEY GENERATION
// =============================================================================

/**
 * Generate unique key for fee tier.
 */
export function getFeeTierKey({
  feeTier,
  tickSpacing,
  isDynamicFee,
}: {
  feeTier: number;
  tickSpacing: number;
  isDynamicFee?: boolean;
}): string;
export function getFeeTierKey({
  feeTier,
  tickSpacing,
  isDynamicFee,
}: {
  feeTier?: number;
  tickSpacing?: number;
  isDynamicFee?: boolean;
}): string | undefined;
export function getFeeTierKey({
  feeTier,
  tickSpacing,
  isDynamicFee,
}: {
  feeTier?: number;
  tickSpacing?: number;
  isDynamicFee?: boolean;
}): string | undefined {
  if (feeTier === undefined || tickSpacing === undefined) {
    return undefined;
  }
  return `${feeTier}-${tickSpacing}${isDynamicFee ? '-dynamic' : ''}`;
}

// =============================================================================
// FEE TIER IDENTIFICATION
// =============================================================================

/**
 * Check if fee data represents a dynamic fee tier.
 */
export function isDynamicFeeTier(feeData?: FeeData): boolean {
  if (!feeData) return false;
  return feeData.isDynamic || feeData.feeAmount === DYNAMIC_FEE_AMOUNT;
}

/**
 * Get descriptive title for fee tier.
 */
export function getFeeTierTitle(feeAmount: number, isDynamic?: boolean): string {
  // Standard Uniswap V3 fee amounts
  switch (feeAmount) {
    case 100: // 0.01%
      return 'Best for very stable pairs';
    case 500: // 0.05%
      return 'Best for stable pairs';
    case 3000: // 0.3%
      return 'Best for most pairs';
    case 10000: // 1%
      return 'Best for exotic pairs';
    default:
      if (isDynamic) {
        return 'Dynamic fee - adjusts based on market conditions';
      }
      return '';
  }
}

// =============================================================================
// POOL TYPE UTILITIES
// =============================================================================

/**
 * Get pool type information based on tick spacing.
 */
export function getPoolTypeInfo(tickSpacing: number, poolType?: string): PoolTypeInfo {
  // Use explicit pool type if provided
  if (poolType === 'Stable') {
    return {
      type: 'Stable',
      description: 'Optimized for stable pairs with minimal price deviation',
      typicalTickSpacing: tickSpacing,
      isStablePair: true,
    };
  }

  // Infer from tick spacing
  if (tickSpacing === 1) {
    return {
      type: 'Stable',
      description: 'Tightest tick spacing for 1:1 pegged assets',
      typicalTickSpacing: 1,
      isStablePair: true,
    };
  }

  if (tickSpacing <= 10) {
    return {
      type: 'Stable',
      description: 'Narrow tick spacing for correlated assets',
      typicalTickSpacing: tickSpacing,
      isStablePair: true,
    };
  }

  return {
    type: poolType || 'Standard',
    description: 'Standard pool for volatile pairs',
    typicalTickSpacing: tickSpacing,
    isStablePair: false,
  };
}

// =============================================================================
// DYNAMIC FEE VISUALIZATION - Alphix Extension
// =============================================================================

/**
 * Calculate dynamic fee visualization data.
 *
 * Alphix's Unified Pools use a dynamic fee algorithm that adjusts fees
 * based on market conditions (represented by the ratio).
 *
 * - When currentRatio < targetRatio: Fee is discounted (attract liquidity)
 * - When currentRatio > targetRatio: Fee is increased (balance pools)
 *
 * @param baseFee - Base fee in raw format (e.g., 8388608 for dynamic flag)
 * @param targetRatio - Target ratio (1e18 scale, e.g., "1000000000000000000")
 * @param currentRatio - Current ratio (1e18 scale, e.g., "700000000000000000")
 * @param effectiveFeeRate - Current effective fee rate in basis points (optional)
 */
export function getDynamicFeeVisualization(
  baseFee: number,
  targetRatio: string,
  currentRatio: string,
  effectiveFeeRate?: number
): DynamicFeeVisualization {
  // Parse ratios (1e18 scale to decimal)
  const targetRatioDecimal = parseFloat(targetRatio) / 1e18;
  const currentRatioDecimal = parseFloat(currentRatio) / 1e18;

  // Default base fee if dynamic flag is set
  const baseFeeBps = baseFee === DYNAMIC_FEE_AMOUNT ? 3000 : baseFee; // 0.3% default

  // Calculate fee adjustment based on ratio difference
  // This is a simplified model - actual algorithm may vary
  const ratioDeviation = (currentRatioDecimal - targetRatioDecimal) / targetRatioDecimal;

  // Fee adjustment: negative deviation = discount, positive = premium
  // Clamped to reasonable bounds (-50% to +100%)
  const adjustmentFactor = Math.max(-0.5, Math.min(1.0, ratioDeviation));
  const feeAdjustmentPercent = adjustmentFactor * 100;

  // Calculate current fee
  const currentFeeBps = effectiveFeeRate ?? Math.round(baseFeeBps * (1 + adjustmentFactor));

  const isDiscounted = currentFeeBps < baseFeeBps;
  const savingsPercent = isDiscounted
    ? ((baseFeeBps - currentFeeBps) / baseFeeBps) * 100
    : undefined;

  // Generate description
  let description: string;
  if (isDiscounted) {
    description = `Fee reduced by ${Math.abs(feeAdjustmentPercent).toFixed(1)}% to attract liquidity`;
  } else if (feeAdjustmentPercent > 0) {
    description = `Fee increased by ${feeAdjustmentPercent.toFixed(1)}% to balance pools`;
  } else {
    description = 'Fee at baseline - pools are balanced';
  }

  return {
    currentFeeBps,
    baseFeeBps,
    targetRatio,
    currentRatio,
    feeAdjustmentPercent,
    isDiscounted,
    description,
    savingsPercent,
  };
}

/**
 * Format dynamic fee as user-friendly string.
 */
export function formatDynamicFee(visualization: DynamicFeeVisualization): string {
  const feePercent = visualization.currentFeeBps / BIPS_BASE;
  const formattedFee = `${feePercent.toFixed(2)}%`;

  if (visualization.isDiscounted && visualization.savingsPercent) {
    return `${formattedFee} (${visualization.savingsPercent.toFixed(0)}% off)`;
  }

  return formattedFee;
}

/**
 * Get color indicator for dynamic fee state.
 * Returns a semantic color name for UI styling.
 */
export function getDynamicFeeColor(
  visualization: DynamicFeeVisualization
): 'success' | 'warning' | 'neutral' {
  if (visualization.isDiscounted) {
    return 'success'; // Green - good for users
  }
  if (visualization.feeAdjustmentPercent > 20) {
    return 'warning'; // Yellow - elevated fee
  }
  return 'neutral'; // Gray - normal state
}

/**
 * Compare fee tiers and return savings info.
 * Useful for showing benefit of dynamic fees vs static alternatives.
 */
export function compareFeeTiers(
  dynamicFee: DynamicFeeVisualization,
  staticFeeBps: number
): {
  difference: number;
  percentSavings: number;
  isBetter: boolean;
  description: string;
} {
  const difference = staticFeeBps - dynamicFee.currentFeeBps;
  const percentSavings = (difference / staticFeeBps) * 100;
  const isBetter = difference > 0;

  let description: string;
  if (isBetter) {
    description = `Save ${percentSavings.toFixed(1)}% vs ${formatFeePercent(staticFeeBps)} static fee`;
  } else if (difference < 0) {
    description = `${Math.abs(percentSavings).toFixed(1)}% higher than ${formatFeePercent(staticFeeBps)} static fee`;
  } else {
    description = `Same as ${formatFeePercent(staticFeeBps)} static fee`;
  }

  return {
    difference,
    percentSavings,
    isBetter,
    description,
  };
}

// =============================================================================
// FEE TIER SORTING & FILTERING
// =============================================================================

/**
 * Sort fee tiers by TVL (descending).
 */
export function sortFeeTiersByTvl<T extends { tvl: string }>(a: T, b: T): number {
  const tvlA = parseFloat(a.tvl || '0');
  const tvlB = parseFloat(b.tvl || '0');
  return tvlB - tvlA;
}

/**
 * Sort fee tiers by fee amount (ascending).
 */
export function sortFeeTiersByFee<T extends { fee: FeeData }>(a: T, b: T): number {
  // Dynamic fees should be last in ascending order
  if (isDynamicFeeTier(a.fee) && !isDynamicFeeTier(b.fee)) return 1;
  if (!isDynamicFeeTier(a.fee) && isDynamicFeeTier(b.fee)) return -1;
  return a.fee.feeAmount - b.fee.feeAmount;
}

// =============================================================================
// ALPHIX-SPECIFIC UTILITIES
// =============================================================================

/**
 * Get default fee data for Alphix pools.
 * All Alphix pools use dynamic fees with pool-specific tick spacing.
 */
export function getAlphixFeeData(tickSpacing: number): FeeData {
  return {
    isDynamic: true,
    feeAmount: DYNAMIC_FEE_AMOUNT,
    tickSpacing,
  };
}

/**
 * Check if a fee represents the Alphix dynamic fee flag.
 */
export function isAlphixDynamicFee(fee: number): boolean {
  return fee === DYNAMIC_FEE_AMOUNT;
}

/**
 * Create fee data from pool configuration.
 */
export function createFeeDataFromPoolConfig(pool: {
  fee: number;
  tickSpacing: number;
}): FeeData {
  return {
    isDynamic: pool.fee === DYNAMIC_FEE_AMOUNT,
    feeAmount: pool.fee,
    tickSpacing: pool.tickSpacing,
  };
}
