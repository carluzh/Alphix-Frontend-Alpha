import { gql } from '@apollo/client'

/**
 * Reusable GraphQL fragments following Uniswap's pattern
 * @see interface/packages/api/src/clients/graphql/web/SimpleToken.graphql
 */

export const TOKEN_FIELDS = gql`
  fragment TokenFields on Token {
    id
    chain
    address
    symbol
    name
    decimals
    priceUSD
    priceChange24h
  }
`

export const POSITION_TOKEN_FIELDS = gql`
  fragment PositionTokenFields on PositionToken {
    address
    symbol
    amount
    rawAmount
  }
`

export const POOL_TICK_FIELDS = gql`
  fragment PoolTickFields on PoolTick {
    id
    tickIdx
    liquidityGross
    liquidityNet
    price0
    price1
  }
`

export const POOL_STATE_FIELDS = gql`
  fragment PoolStateFields on PoolState {
    chain
    poolId
    sqrtPriceX96
    tick
    liquidity
    protocolFee
    lpFee
    currentPrice
    currentPoolTick
  }
`

export const POOL_FIELDS = gql`
  fragment PoolFields on Pool {
    id
    chain
    poolId
    protocolVersion
    token0 {
      ...TokenFields
    }
    token1 {
      ...TokenFields
    }
    feeTier
    tickSpacing
    hook {
      id
      address
    }
    sqrtPriceX96
    tick
    liquidity
    currentPrice
    protocolFee
    lpFee
    tvlUSD
    volume24hUSD
    fees24hUSD
    dynamicFeeBps
    apr
  }
  ${TOKEN_FIELDS}
`

export const POSITION_FIELDS = gql`
  fragment PositionFields on Position {
    id
    chain
    positionId
    owner
    poolId
    token0 {
      ...PositionTokenFields
    }
    token1 {
      ...PositionTokenFields
    }
    tickLower
    tickUpper
    liquidity
    ageSeconds
    blockTimestamp
    lastTimestamp
    isInRange
    token0UncollectedFees
    token1UncollectedFees
    valueUSD
    feesUSD
  }
  ${POSITION_TOKEN_FIELDS}
`

export const TIMESTAMPED_POOL_PRICE_FIELDS = gql`
  fragment TimestampedPoolPriceFields on TimestampedPoolPrice {
    id
    timestamp
    token0Price
    token1Price
  }
`
