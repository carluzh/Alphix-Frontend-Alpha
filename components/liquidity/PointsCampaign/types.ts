/**
 * Points Campaign Type Definitions
 *
 * Mirrors Uniswap's LP Incentives types from:
 * - interface/apps/web/src/components/Liquidity/types.ts (PositionInfo with rewards fields)
 * - interface/apps/web/src/hooks/useLpIncentivesFormattedEarnings.ts (return types)
 *
 * Alphix Points Campaign uses points instead of UNI token rewards.
 */

/**
 * Points data attached to a liquidity position.
 * Mirrors V4PositionInfo reward fields.
 *
 * @example
 * ```typescript
 * const pointsData: PositionPointsData = {
 *   pointsEarned: '1500',
 *   pointsApr: 12.5, // 12.5% equivalent
 *   isEligible: true,
 * };
 * ```
 */
export interface PositionPointsData {
  /** Raw points earned (string for precision) */
  pointsEarned?: string;
  /** Points APR equivalent (mirrors boostedApr) */
  pointsApr?: number;
  /** Total APR including points (mirrors totalApr) */
  totalApr?: number;
  /** Whether position is eligible for points campaign */
  isEligible: boolean;
}

/**
 * Formatted points earnings result.
 * Mirrors LpIncentivesEarningsResult from useLpIncentivesFormattedEarnings.
 */
export interface PointsEarningsResult {
  /** Formatted points amount for display (e.g., "1,500 pts") */
  formattedPointsEarned?: string;
  /** Whether position has earned points */
  hasPoints: boolean;
  /** Total formatted earnings (fees + points equivalent) */
  totalFormattedEarnings?: string;
}

/**
 * Props for points tooltip display.
 * Mirrors LpIncentiveAprTooltipProps.
 */
export interface PointsTooltipProps {
  /** Token0 symbol */
  token0Symbol?: string;
  /** Token1 symbol */
  token1Symbol?: string;
  /** Pool APR (trading fees) */
  poolApr?: number;
  /** Points APR equivalent */
  pointsApr?: number;
  /** Total APR (pool + points) */
  totalApr?: number;
}
