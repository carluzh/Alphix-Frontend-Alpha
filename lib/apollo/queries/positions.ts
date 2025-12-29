/**
 * Position Queries
 *
 * GraphQL queries for liquidity positions.
 * These queries hit our /api/graphql endpoint with proper resolvers.
 *
 * @see interface/packages/api/src/clients/graphql/web/positions.graphql
 */

import { gql } from '@apollo/client'

/**
 * Query to fetch user positions
 */
export const GET_USER_POSITIONS = gql`
  query GetUserPositions($chain: Chain!, $owner: String!) {
    userPositions(chain: $chain, owner: $owner) {
      id
      chain
      positionId
      owner
      poolId
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
      tickLower
      tickUpper
      liquidity
      ageSeconds
      blockTimestamp
      lastTimestamp
      isInRange
      token0UncollectedFees
      token1UncollectedFees
    }
  }
`

/**
 * Query to fetch a single position
 */
export const GET_POSITION = gql`
  query GetPosition($chain: Chain!, $positionId: String!) {
    position(chain: $chain, positionId: $positionId) {
      id
      chain
      positionId
      owner
      poolId
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
  }
`

/**
 * Query to fetch position fees
 */
export const GET_POSITION_FEES = gql`
  query GetPositionFees($chain: Chain!, $positionId: String!) {
    positionFees(chain: $chain, positionId: $positionId) {
      positionId
      token0Fees
      token1Fees
      token0FeesUSD
      token1FeesUSD
    }
  }
`
