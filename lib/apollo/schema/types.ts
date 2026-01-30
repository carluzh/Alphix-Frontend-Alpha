/**
 * Apollo Schema Types
 *
 * TypeScript types that mirror the GraphQL schema.
 * These are used for type-safe query results and cache operations.
 */

/**
 * Supported blockchain networks
 */
export type Chain = 'BASE' | 'BASE_SEPOLIA'

/**
 * Token type - represents a cryptocurrency token
 */
export interface Token {
  __typename: 'Token'
  chain: Chain
  address: string
  symbol: string
  decimals?: number
  name?: string
  priceUSD?: number | null
  priceChange24h?: number | null
}

/**
 * Pool type - represents a liquidity pool
 */
export interface Pool {
  __typename: 'Pool'
  chain: Chain
  poolId: string
  token0: Token
  token1: Token
  feeTier: number
  tickSpacing: number
  sqrtPriceX96?: string
  tick?: number
  liquidity?: string
  tvlUSD?: number
  volume24hUSD?: number
  apr?: number
}

/**
 * Pool state - current on-chain state of a pool
 */
export interface PoolState {
  __typename: 'PoolState'
  chain: Chain
  poolId: string
  sqrtPriceX96: string
  tick: number
  liquidity: string
  token0Price?: number
  token1Price?: number
  currentPrice?: number
  currentPoolTick?: number
}

/**
 * Position type - represents a liquidity position
 */
export interface Position {
  __typename: 'Position'
  chain: Chain
  positionId: string
  owner: string
  poolId: string
  pool?: Pool
  tickLower: number
  tickUpper: number
  liquidity: string
  liquidityRaw?: string
  token0?: {
    address: string
    symbol: string
    amount: string
    rawAmount?: string
  }
  token1?: {
    address: string
    symbol: string
    amount: string
    rawAmount?: string
  }
  uncollectedFees0?: string
  uncollectedFees1?: string
  valueUSD?: number
  isInRange?: boolean
  isPending?: boolean
  isRemoving?: boolean
  isOptimisticallyUpdating?: boolean
  ageSeconds?: number
  blockTimestamp?: number
  lastTimestamp?: number
}

/**
 * Price history entry
 */
export interface PriceHistory {
  __typename: 'PriceHistory'
  timestamp: number
  token0Price: number
  token1Price: number
}

/**
 * Price history response
 */
export interface PriceHistoryResponse {
  __typename: 'PriceHistoryResponse'
  entries: PriceHistory[]
  source: 'uniswap' | 'coingecko'
}

/**
 * Uncollected fees for a position
 */
export interface FeeItem {
  __typename: 'FeeItem'
  positionId: string
  amount0: string
  amount1: string
  amount0USD?: number
  amount1USD?: number
}

/**
 * Uncollected fees response
 */
export interface UncollectedFees {
  __typename: 'UncollectedFees'
  items: FeeItem[]
}

/**
 * Query result types
 */

export interface PoolQueryResult {
  pool: Pool | null
}

export interface PoolStateQueryResult {
  poolState: PoolState | null
}

export interface UserPositionsQueryResult {
  userPositions: Position[]
}

export interface PriceHistoryQueryResult {
  poolPriceHistory: PriceHistoryResponse
}

export interface UncollectedFeesQueryResult {
  uncollectedFees: UncollectedFees
}
