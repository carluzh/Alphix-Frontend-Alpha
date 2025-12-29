/**
 * Apollo GraphQL Fragments
 *
 * Reusable fragments for consistent field selection across queries.
 * @see interface/packages/uniswap/src/data/graphql/uniswap-data-api/fragments.graphql
 */

import { gql } from '@apollo/client'

/**
 * Token fields fragment
 */
export const TOKEN_FIELDS = gql`
  fragment TokenFields on Token {
    chain
    address
    symbol
    decimals
    name
    priceUSD
    priceChange24h
  }
`

/**
 * Pool fields fragment
 */
export const POOL_FIELDS = gql`
  fragment PoolFields on Pool {
    chain
    poolId
    token0 {
      ...TokenFields
    }
    token1 {
      ...TokenFields
    }
    feeTier
    tickSpacing
    sqrtPriceX96
    tick
    liquidity
    tvlUSD
    volume24hUSD
    apr
  }
  ${TOKEN_FIELDS}
`

/**
 * Pool state fragment (on-chain data)
 */
export const POOL_STATE_FIELDS = gql`
  fragment PoolStateFields on PoolState {
    chain
    poolId
    sqrtPriceX96
    tick
    liquidity
    token0Price
    token1Price
  }
`

/**
 * Position fields fragment
 */
export const POSITION_FIELDS = gql`
  fragment PositionFields on Position {
    chain
    positionId
    owner
    poolId
    tickLower
    tickUpper
    liquidity
    liquidityRaw
    token0 {
      address
      symbol
      amount
      rawAmount
    }
    token1 {
      address
      symbol
      amount
      rawAmount
    }
    uncollectedFees0
    uncollectedFees1
    valueUSD
    isInRange
    isPending
    isRemoving
    isOptimisticallyUpdating
    ageSeconds
    blockTimestamp
    lastTimestamp
  }
`

/**
 * Position with pool fragment
 */
export const POSITION_WITH_POOL_FIELDS = gql`
  fragment PositionWithPoolFields on Position {
    ...PositionFields
    pool {
      ...PoolFields
    }
  }
  ${POSITION_FIELDS}
  ${POOL_FIELDS}
`

/**
 * Price history fragment
 */
export const PRICE_HISTORY_FIELDS = gql`
  fragment PriceHistoryFields on PriceHistory {
    timestamp
    token0Price
    token1Price
  }
`

/**
 * Fee item fragment
 */
export const FEE_ITEM_FIELDS = gql`
  fragment FeeItemFields on FeeItem {
    positionId
    amount0
    amount1
    amount0USD
    amount1USD
  }
`
