import { createSchema, createYoga } from 'graphql-yoga'
import { readFileSync } from 'fs'
import { join } from 'path'
import { cookies } from 'next/headers'

// Import resolvers
import { resolvers } from './resolvers'

/**
 * GraphQL API Route
 *
 * Full GraphQL server endpoint using graphql-yoga.
 * Resolvers call our existing REST API endpoints internally.
 *
 * @see interface/packages/api/src/graphql (Uniswap's data-api)
 */

// Read schema from file
const schemaPath = join(process.cwd(), 'lib/apollo/schema/schema.graphql')
let typeDefs: string

try {
  typeDefs = readFileSync(schemaPath, 'utf-8')
} catch {
  // Fallback for build time when file might not be available
  typeDefs = `
    type Query {
      _health: String
    }
  `
}

const schema = createSchema({
  typeDefs,
  resolvers,
})

const { handleRequest } = createYoga({
  schema,
  graphqlEndpoint: '/api/graphql',
  fetchAPI: { Response },
  // Context function to pass request info to resolvers
  context: async ({ request }) => {
    // Get network mode from cookies
    const cookieStore = await cookies()
    const networkModeCookie = cookieStore.get('network-mode')
    const networkMode = networkModeCookie?.value === 'testnet' ? 'testnet' : 'mainnet'

    return {
      networkMode,
      request,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    }
  },
})

export { handleRequest as GET, handleRequest as POST }
