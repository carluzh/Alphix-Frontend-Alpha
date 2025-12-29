/**
 * Pool Queries
 *
 * GraphQL queries for pool data.
 * These queries hit our /api/graphql endpoint with proper resolvers.
 *
 * @see interface/packages/api/src/clients/graphql/web/pool.graphql
 */

import { gql } from '@apollo/client'

/**
 * Query to fetch pool state (on-chain data)
 */
export const GET_POOL_STATE = gql`
  query GetPoolState($chain: Chain!, $poolId: String!) {
    poolState(chain: $chain, poolId: $poolId) {
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
  }
`

/**
 * Query to fetch full pool data
 */
export const GET_POOL = gql`
  query GetPool($chain: Chain!, $poolId: String!) {
    pool(chain: $chain, poolId: $poolId) {
      id
      chain
      poolId
      protocolVersion
      sqrtPriceX96
      tick
      liquidity
      currentPrice
      tvlUSD
      volume24hUSD
      apr
    }
  }
`

/**
 * Query to fetch pool metrics
 */
export const GET_POOL_METRICS = gql`
  query GetPoolMetrics($chain: Chain!, $poolId: String!) {
    poolMetrics(chain: $chain, poolId: $poolId) {
      poolId
      tvlUSD
      volume24hUSD
      fees24hUSD
      dynamicFeeBps
      apr
    }
  }
`

/**
 * Query to fetch pool price history
 */
export const GET_POOL_PRICE_HISTORY = gql`
  query GetPoolPriceHistory($chain: Chain!, $poolId: String!, $duration: HistoryDuration!) {
    poolPriceHistory(chain: $chain, poolId: $poolId, duration: $duration) {
      id
      timestamp
      token0Price
      token1Price
    }
  }
`

/**
 * Query to fetch pool ticks
 */
export const GET_POOL_TICKS = gql`
  query GetPoolTicks($chain: Chain!, $poolId: String!, $skip: Int, $first: Int) {
    poolTicks(chain: $chain, poolId: $poolId, skip: $skip, first: $first) {
      id
      tickIdx
      liquidityGross
      liquidityNet
      price0
      price1
    }
  }
`
