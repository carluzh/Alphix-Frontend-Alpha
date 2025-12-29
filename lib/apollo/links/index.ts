/**
 * Apollo Link Chain
 *
 * Uniswap-aligned link configuration.
 * Uses getter functions for configurable link creation.
 *
 * @see interface/packages/uniswap/src/data/links.ts
 */

import { ApolloLink, from } from '@apollo/client'
import { getErrorLink } from './errorLink'
import { getNetworkModeLink } from './networkModeLink'
import { getRestLink } from './restLink'

/**
 * Get composed link chain for Apollo Client
 * Order: errorLink -> networkModeLink -> restLink
 */
export function getLink(): ApolloLink {
  return from([
    getErrorLink(),
    getNetworkModeLink(),
    getRestLink(),
  ])
}

// Default link instance
export const link = getLink()

// Re-export link factories
export { getErrorLink } from './errorLink'
export { getNetworkModeLink } from './networkModeLink'
export { getRestLink } from './restLink'
