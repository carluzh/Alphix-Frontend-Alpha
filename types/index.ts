export interface Pool {
  id: string;
  tokens: {
    symbol: string;
    icon: string;
    address?: string;
  }[];
  pair: string;
  volume24h: string;
  fees24h: string;
  volume24hUSD?: number;
  fees24hUSD?: number;
  liquidity: string;
  tvlUSD?: number;
  apr: string;
  highlighted: boolean;
  positionsCount?: number;
  dynamicFeeBps?: number;
  type?: string;
}

/**
 * Position status aligned with Uniswap's pattern
 */
export type PositionStatus = 'IN_RANGE' | 'OUT_OF_RANGE' | 'CLOSED';

// =============================================================================
// POINTS CAMPAIGN TYPES
// Mirrors Uniswap's LP Incentives from:
// - interface/apps/web/src/components/Liquidity/types.ts (V4PositionInfo)
// =============================================================================

/**
 * Points data attached to a liquidity position.
 * Mirrors V4PositionInfo reward fields (boostedApr, totalApr, unclaimedRewardsAmountUni).
 *
 * @example
 * ```typescript
 * const pointsData: PositionPointsData = {
 *   pointsEarned: '1500',
 *   pointsApr: 12.5,
 *   isEligible: true,
 * };
 * ```
 */
export interface PositionPointsData {
  /** Raw points earned (string for precision, mirrors unclaimedRewardsAmountUni) */
  pointsEarned?: string;
  /** Points APR equivalent (mirrors boostedApr) */
  pointsApr?: number;
  /** Total APR including points (mirrors totalApr) */
  totalApr?: number;
  /** Unified Yield APR from Aave lending (for rehypo positions) */
  unifiedYieldApr?: number;
  /** Whether position is eligible for points campaign */
  isEligible: boolean;
}
