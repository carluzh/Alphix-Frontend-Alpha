/**
 * Position GraphQL Mappers
 *
 * Maps API position responses to GraphQL Position types.
 * This mapper only handles V4 positions - Unified Yield positions are
 * fetched and handled separately in the client layer for clean separation.
 *
 * @see lib/apollo/links/restLink.ts - typePatcher pattern
 * @see interface/packages/api/src/graphql/mappers (Uniswap pattern)
 */

import type { V4ProcessedPosition } from '@/pages/api/liquidity/get-positions';

/**
 * GraphQL Position type (matches schema.graphql Position type)
 *
 * Note: isUnifiedYield and related fields are kept for schema compatibility
 * but will always be false/undefined for positions from this API.
 */
export interface GraphQLPosition {
  id: string;
  chain: string;
  positionId: string;
  owner: string;
  poolId: string;
  pool: null; // Resolved separately
  token0: {
    address: string;
    symbol: string;
    amount: string;
    rawAmount: string;
  };
  token1: {
    address: string;
    symbol: string;
    amount: string;
    rawAmount: string;
  };
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  ageSeconds: number;
  blockTimestamp: number;
  lastTimestamp: number;
  isInRange: boolean;
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
  valueUSD: null;
  feesUSD: null;
  // Schema compatibility fields (always false/undefined for V4 positions)
  isUnifiedYield: boolean;
  shareBalance?: string;
  shareBalanceFormatted?: string;
  hookAddress?: string;
}

/**
 * Maps a single V4 position to GraphQL Position type
 *
 * @param pos - V4 position from API response
 * @param chain - Chain identifier (BASE or BASE_SEPOLIA)
 * @returns GraphQL-compatible Position object
 */
export function mapPositionToGraphQL(
  pos: V4ProcessedPosition,
  chain: string
): GraphQLPosition {
  return {
    id: `${chain}:${pos.positionId}`,
    chain,
    pool: null,
    valueUSD: null,
    feesUSD: null,
    positionId: pos.positionId,
    owner: pos.owner,
    poolId: pos.poolId,
    tickLower: pos.tickLower,
    tickUpper: pos.tickUpper,
    liquidity: pos.liquidityRaw,
    ageSeconds: pos.ageSeconds,
    blockTimestamp: pos.blockTimestamp,
    lastTimestamp: pos.lastTimestamp,
    isInRange: pos.isInRange,
    token0UncollectedFees: pos.token0UncollectedFees,
    token1UncollectedFees: pos.token1UncollectedFees,
    token0: {
      address: pos.token0.address,
      symbol: pos.token0.symbol,
      amount: pos.token0.amount,
      rawAmount: pos.token0.rawAmount,
    },
    token1: {
      address: pos.token1.address,
      symbol: pos.token1.symbol,
      amount: pos.token1.amount,
      rawAmount: pos.token1.rawAmount,
    },
    // V4 positions are never Unified Yield
    isUnifiedYield: false,
    shareBalance: undefined,
    shareBalanceFormatted: undefined,
    hookAddress: undefined,
  };
}

/**
 * Maps an array of V4 positions to GraphQL Position types
 *
 * @param positions - Array of V4 positions from API response
 * @param chain - Chain identifier (BASE or BASE_SEPOLIA)
 * @returns Array of GraphQL-compatible Position objects
 */
export function mapPositionsToGraphQL(
  positions: V4ProcessedPosition[],
  chain: string
): GraphQLPosition[] {
  return positions.map((pos) => mapPositionToGraphQL(pos, chain));
}
