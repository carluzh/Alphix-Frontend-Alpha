/**
 * Apollo Network Mode Link
 *
 * Injects network mode (mainnet/testnet) into request context.
 * This allows queries to be network-aware without manual parameter passing.
 *
 * @see interface/packages/uniswap/src/data/links.ts
 */

import { ApolloLink } from '@apollo/client'
import { getStoredNetworkMode, type NetworkMode } from '@/lib/network-mode'

/**
 * Get current network mode safely (works on both client and server)
 */
function getCurrentNetworkMode(): NetworkMode {
  return getStoredNetworkMode()
}

/**
 * Get link that adds network mode to operation context and headers.
 * Downstream links and resolvers can access via context.networkMode
 */
export function getNetworkModeLink(): ApolloLink {
  return new ApolloLink((operation, forward) => {
    const networkMode = getCurrentNetworkMode()
    const chain = networkMode === 'mainnet' ? 'BASE' : 'BASE_SEPOLIA'

    operation.setContext(({ headers = {} }) => ({
      headers: {
        ...headers,
        'x-network-mode': networkMode,
        'x-chain': chain,
      },
      networkMode,
      chain,
    }))

    return forward(operation)
  })
}

// Default export for backward compatibility
export const networkModeLink = getNetworkModeLink()
