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
  BASE_SEPOLIA
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
  # Ticks data
  ticks(skip: Int, first: Int): [PoolTick!]
}

type PoolHook {
  id: ID!
  address: String!
}

type PoolTick {
  id: ID!
  tickIdx: Int!
  liquidityGross: String!
  liquidityNet: String!
  price0: String
  price1: String
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

type PoolMetrics {
  poolId: String!
  tvlUSD: Float!
  volume24hUSD: Float!
  fees24hUSD: Float!
  dynamicFeeBps: Float!
  apr: Float!
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
# SWAP TYPES
# =============================================================================

type SwapQuote {
  amountIn: String!
  amountOut: String!
  path: [String!]!
  fees: [Int!]!
  priceImpact: Float
  minimumReceived: String
}

type SwapTransaction {
  to: String!
  data: String!
  value: String!
  gasLimit: String
}

# =============================================================================
# PRICE TYPES
# =============================================================================

type TokenPrice {
  symbol: String!
  priceUSD: Float!
  priceChange24h: Float
  timestamp: Int!
}

type AllTokenPrices {
  BTC: Float
  aBTC: Float
  ETH: Float
  aETH: Float
  USDC: Float
  aUSDC: Float
  USDT: Float
  aUSDT: Float
  timestamp: Int!
}

# =============================================================================
# INPUT TYPES
# =============================================================================

input SwapQuoteInput {
  tokenIn: String!
  tokenOut: String!
  amount: String!
  exactIn: Boolean!
  slippageTolerance: Float
}

input BuildSwapTxInput {
  tokenIn: String!
  tokenOut: String!
  amountIn: String!
  amountOutMin: String!
  recipient: String!
  deadline: Int!
}

input TicksInput {
  poolId: String!
  skip: Int
  first: Int
}

# =============================================================================
# QUERIES
# =============================================================================

type Query {
  # Health check
  _health: String

  # Token queries
  token(chain: Chain!, address: String): Token
  tokenPrices(chain: Chain!): AllTokenPrices!

  # Pool queries
  pool(chain: Chain!, poolId: String!): Pool
  pools(chain: Chain!, first: Int, skip: Int): [Pool!]!
  poolState(chain: Chain!, poolId: String!): PoolState
  poolMetrics(chain: Chain!, poolId: String!): PoolMetrics
  poolPriceHistory(chain: Chain!, poolId: String!, duration: HistoryDuration!): [TimestampedPoolPrice!]!
  poolTicks(chain: Chain!, poolId: String!, skip: Int, first: Int): [PoolTick!]!

  # Position queries
  position(chain: Chain!, positionId: String!): Position
  userPositions(chain: Chain!, owner: String!): [Position!]!
  positionFees(chain: Chain!, positionId: String!): FeeItem

  # Swap queries
  swapQuote(chain: Chain!, input: SwapQuoteInput!): SwapQuote
}

# =============================================================================
# MUTATIONS
# =============================================================================

type Mutation {
  # Swap mutations
  buildSwapTransaction(chain: Chain!, input: BuildSwapTxInput!): SwapTransaction
}
`
