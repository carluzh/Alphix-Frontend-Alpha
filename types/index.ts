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
}
