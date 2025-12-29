/**
 * Price Queries
 *
 * GraphQL queries for token prices.
 * These queries hit our /api/graphql endpoint with proper resolvers.
 *
 * @see interface/packages/api/src/clients/graphql/web/token.graphql
 */

import { gql } from '@apollo/client'

/**
 * Query to fetch all token prices
 */
export const GET_TOKEN_PRICES = gql`
  query GetTokenPrices($chain: Chain!) {
    tokenPrices(chain: $chain) {
      BTC
      aBTC
      ETH
      aETH
      USDC
      aUSDC
      USDT
      aUSDT
      timestamp
    }
  }
`

/**
 * Query to fetch a single token
 */
export const GET_TOKEN = gql`
  query GetToken($chain: Chain!, $address: String) {
    token(chain: $chain, address: $address) {
      id
      chain
      address
      symbol
      name
      decimals
      priceUSD
      priceChange24h
    }
  }
`
