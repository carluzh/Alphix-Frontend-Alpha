/**
 * Apollo REST Link
 *
 * Handles fetching data from REST APIs.
 * Responses will be stored in graphql cache.
 *
 * @see interface/packages/uniswap/src/data/links.ts
 */

import { ApolloLink } from '@apollo/client'
import { RestLink } from 'apollo-link-rest'
import { getStoredNetworkMode } from '@/lib/network-mode'
import { getAllTokenSymbols } from '@/lib/pools-config'

/**
 * Get REST link for Alphix API endpoints
 */
export function getRestLink(): ApolloLink {
  const restUri = '/api'

  return new RestLink({
    uri: restUri,
    headers: {
      'Content-Type': 'application/json',
    },

    // Response transformers - convert REST responses to GraphQL-compatible shapes
    responseTransformer: async (response: Response, typeName: string) => {
      const data = await response.json()

      // Handle error responses
      if (!response.ok) {
        throw new Error(data.message || data.error || 'API request failed')
      }

      // Extract data from wrapped responses
      if (data.success !== undefined) {
        return data.data || data
      }

      return data
    },

    // Type patchers - add __typename to response objects
    typePatcher: {
      TokenPrices: (data: any) => {
        if (!data) return data
        const networkMode = getStoredNetworkMode()
        const chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

        // Convert price response to Token array - use config-derived token list
        const tokens = getAllTokenSymbols(networkMode)
          .filter(symbol => data[symbol])
          .map(symbol => ({
            __typename: 'Token',
            chain,
            symbol,
            address: symbol.toLowerCase(),
            priceUSD: data[symbol]?.usd ?? 0,
            priceChange24h: data[symbol]?.usd_24h_change ?? null,
          }))

        return { tokens, lastUpdated: data.lastUpdated }
      },

      Pool: (data: any) => {
        if (!data) return data
        const networkMode = getStoredNetworkMode()
        return {
          __typename: 'Pool',
          chain: networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA',
          ...data,
        }
      },

      Position: (data: any) => {
        if (!data) return data
        const networkMode = getStoredNetworkMode()
        return {
          __typename: 'Position',
          chain: networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA',
          ...data,
        }
      },

      PositionArray: (data: any) => {
        if (!Array.isArray(data)) return data
        const networkMode = getStoredNetworkMode()
        const chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

        return data.map(position => ({
          __typename: 'Position',
          chain,
          ...position,
        }))
      },

      PriceHistory: (data: any) => {
        if (!data) return data
        return {
          __typename: 'PriceHistoryResponse',
          entries: Array.isArray(data.data) ? data.data.map((entry: any) => ({
            __typename: 'PriceHistory',
            ...entry,
          })) : [],
          source: data.source,
        }
      },

      PoolState: (data: any) => {
        if (!data) return data
        const networkMode = getStoredNetworkMode()
        return {
          __typename: 'PoolState',
          chain: networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA',
          ...data,
        }
      },

      UncollectedFees: (data: any) => {
        if (!data) return data
        return {
          __typename: 'UncollectedFees',
          items: Array.isArray(data.items) ? data.items.map((item: any) => ({
            __typename: 'FeeItem',
            ...item,
          })) : [],
        }
      },
    },
  })
}

// Default export for backward compatibility
export const restLink = getRestLink()
