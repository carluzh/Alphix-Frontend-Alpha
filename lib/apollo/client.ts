import { ApolloClient, from, HttpLink } from '@apollo/client'
import { setupSharedApolloCache } from '@/lib/apollo/cache'
import { getErrorLink } from '@/lib/apollo/links'

/**
 * Apollo Client Configuration
 *
 * Uses our GraphQL API endpoint (/api/graphql) as primary link.
 * Falls back to RestLink for direct REST calls when needed.
 *
 * @see interface/packages/api/src/clients/graphql (Uniswap's setup)
 */

// Primary GraphQL link - points to our GraphQL server
const httpLink = new HttpLink({
  uri: typeof window !== 'undefined'
    ? `${window.location.origin}/api/graphql`
    : 'http://localhost:3000/api/graphql',
  credentials: 'same-origin',
})

export const apolloClient = new ApolloClient({
  connectToDevTools: process.env.NODE_ENV === 'development',
  // Link chain: error handling -> REST fallback -> GraphQL endpoint
  link: from([getErrorLink(), httpLink]),
  headers: {
    'Content-Type': 'application/json',
    Origin: typeof window !== 'undefined' ? window.location.origin : 'https://app.alphix.io',
  },
  cache: setupSharedApolloCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
    query: {
      fetchPolicy: 'cache-first',
    },
  },
})
