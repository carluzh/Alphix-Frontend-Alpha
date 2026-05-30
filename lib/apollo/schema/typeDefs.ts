/**
 * GraphQL Schema Type Definitions
 *
 * Exported as a string literal so it can be imported directly
 * instead of reading from filesystem (which fails in serverless).
 *
 * NOTE: Keep this in sync with schema.graphql
 */

export const typeDefs = /* GraphQL */ `
# Alphix GraphQL Schema
# Based on Uniswap's schema patterns but adapted for Alphix V4 pools on Base

# =============================================================================
# ENUMS
# =============================================================================

enum Chain {
  BASE
  ARBITRUM
}

enum Currency {
  USD
  ETH
}

enum HistoryDuration {
  HOUR
  DAY
  WEEK
  MONTH
  YEAR
  MAX
}

enum ProtocolVersion {
  V4
}

# =============================================================================
# SCALARS
# =============================================================================

"""
Large number represented as string to preserve precision
"""
scalar BigInt

# =============================================================================
# INTERFACES
# =============================================================================

interface IContract {
  chain: Chain!
  address: String
}

interface IAmount {
  currency: Currency
  value: Float!
}

# =============================================================================
# AMOUNT TYPES
# =============================================================================

type Amount implements IAmount {
  id: ID!
  currency: Currency
  value: Float!
}

type TimestampedAmount implements IAmount {
  id: ID!
  currency: Currency
  value: Float!
  timestamp: Int!
}

type TimestampedPoolPrice {
  id: ID!
  timestamp: Int!
  token0Price: Float!
  token1Price: Float!
}

# =============================================================================
# TOKEN TYPES
# =============================================================================

type Token implements IContract {
  id: ID!
  chain: Chain!
  address: String
  symbol: String!
  name: String
  decimals: Int!
  priceUSD: Float
  priceChange24h: Float
}

type PositionToken {
  address: String!
  symbol: String!
  amount: String!
  rawAmount: String!
}

# =============================================================================
# POOL TYPES
# =============================================================================

type Pool {
  id: ID!
  chain: Chain!
  poolId: String!
  protocolVersion: ProtocolVersion!
  token0: Token!
  token1: Token!
  feeTier: Int
  tickSpacing: Int!
  hook: PoolHook
  # Live state from chain
  sqrtPriceX96: String
  tick: Int
  liquidity: String
  currentPrice: String
  protocolFee: Int
  lpFee: Int
  # Computed metrics
  tvlUSD: Float
  volume24hUSD: Float
  fees24hUSD: Float
  dynamicFeeBps: Float
  apr: Float
  # History
  priceHistory(duration: HistoryDuration!): [TimestampedPoolPrice!]
}

type PoolHook {
  id: ID!
  address: String!
}

type PoolState {
  chain: Chain!
  poolId: String!
  sqrtPriceX96: String!
  tick: Int!
  liquidity: String!
  protocolFee: Int!
  lpFee: Int!
  currentPrice: String!
  currentPoolTick: Int!
}

# =============================================================================
# POSITION TYPES
# =============================================================================

type Position {
  id: ID!
  chain: Chain!
  positionId: String!
  owner: String!
  poolId: String!
  pool: Pool
  token0: PositionToken!
  token1: PositionToken!
  tickLower: Int!
  tickUpper: Int!
  liquidity: String!
  # Timestamps
  ageSeconds: Int!
  blockTimestamp: Int!
  lastTimestamp: Int!
  # Computed
  isInRange: Boolean!
  # Uncollected fees (raw amounts)
  token0UncollectedFees: String
  token1UncollectedFees: String
  # USD values
  valueUSD: Float
  feesUSD: Float
  # Unified Yield (ReHypothecation) specific fields
  isUnifiedYield: Boolean
  shareBalance: String
  shareBalanceFormatted: String
  hookAddress: String
}

type FeeItem {
  positionId: String!
  token0Fees: String!
  token1Fees: String!
  token0FeesUSD: Float
  token1FeesUSD: Float
}

# =============================================================================
# QUERIES
# =============================================================================

type Query {
  # Health check
  _health: String

  # Pool queries
  pool(chain: Chain!, poolId: String!): Pool
  pools(chain: Chain!, first: Int, skip: Int): [Pool!]!
  poolState(chain: Chain!, poolId: String!): PoolState
  poolPriceHistory(chain: Chain!, poolId: String!, duration: HistoryDuration!): [TimestampedPoolPrice!]!

  # Position queries
  position(chain: Chain!, positionId: String!): Position
  userPositions(chain: Chain!, owner: String!): [Position!]!
}

# =============================================================================
# MUTATIONS
# =============================================================================

type Mutation {
  _placeholder: String
}
`
