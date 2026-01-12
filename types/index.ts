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

/**
 * Derive position status from position state
 */
export function getPositionStatus(
  isInRange: boolean,
  liquidityRaw?: string
): PositionStatus {
  // Check if position is closed (no liquidity)
  if (!liquidityRaw || liquidityRaw === '0') {
    return 'CLOSED';
  }

  return isInRange ? 'IN_RANGE' : 'OUT_OF_RANGE';
}

/**
 * Standard position token info
 */
export interface PositionTokenInfo {
  address: string;
  symbol: string;
  amount: string;
  usdValue?: number;
}

/**
 * Processed position type - standardized across the app
 *
 * Mirrors Uniswap's PositionInfo from:
 * - interface/apps/web/src/components/Liquidity/types.ts (BasePositionInfo)
 * - interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts (parseRestPosition)
 */
export interface ProcessedPosition {
  positionId: string;
  owner: string;
  poolId: string;
  token0: PositionTokenInfo;
  token1: PositionTokenInfo;
  tickLower: number;
  tickUpper: number;
  isInRange: boolean;
  ageSeconds: number;
  blockTimestamp: number;
  liquidityRaw?: string;
  status?: PositionStatus;

  // Fee fields - mirrors Uniswap's token0UncollectedFees/token1UncollectedFees
  // @see interface/apps/web/src/components/Liquidity/types.ts (lines 48-49)
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
}

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
