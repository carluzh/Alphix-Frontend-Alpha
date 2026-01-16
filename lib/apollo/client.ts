import { ApolloClient, from, HttpLink } from '@apollo/client'
import { setupSharedApolloCache } from '@/lib/apollo/cache'
import { getErrorLink } from '@/lib/apollo/links'

/**
 * Apollo Client Configuration
 *
 * Uses our GraphQL API endpoint (/api/graphql) as primary link.
 * Falls back to RestLink for direct REST calls when needed.
 *
 * @see interface/apps/web/src/appGraphql/data/apollo/client.ts (Uniswap's setup)
 */

/**
 * Get GraphQL endpoint URL
 * Follows Uniswap's fail-fast pattern - no localhost fallback in production
 */
function getGraphQLEndpoint(): string {
  // Client-side: Use current origin (always works)
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/graphql`
  }

  // Server-side: Require environment variable
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL environment variable is required for server-side GraphQL operations. ' +
      'Set it to http://localhost:3000 in .env.local for development.'
    )
  }
  return `${appUrl}/api/graphql`
}

// Primary GraphQL link - points to our GraphQL server
const httpLink = new HttpLink({
  uri: getGraphQLEndpoint(),
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/json',
    Origin: typeof window !== 'undefined' ? window.location.origin : 'https://app.alphix.io',
  },
})

export const apolloClient = new ApolloClient({
  // Link chain: error handling -> REST fallback -> GraphQL endpoint
  link: from([getErrorLink(), httpLink]),
  cache: setupSharedApolloCache(),
  devtools: { enabled: process.env.NODE_ENV === 'development' },
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
    query: {
      fetchPolicy: 'cache-first',
    },
  },
})
