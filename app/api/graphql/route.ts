import { createSchema, createYoga } from 'graphql-yoga'
import { cookies } from 'next/headers'
import { checkRateLimit } from '@/lib/api/ratelimit'

// Import resolvers and schema as string (works in serverless)
import { resolvers } from './resolvers'
import { typeDefs } from '@/lib/apollo/schema/typeDefs'

/**
 * GraphQL API Route
 *
 * Full GraphQL server endpoint using graphql-yoga.
 * Resolvers call our existing REST API endpoints internally.
 *
 * NOTE: Schema is imported as a string literal instead of reading from
 * filesystem, which doesn't work in serverless environments (Vercel).
 *
 * @see interface/packages/api/src/graphql (Uniswap's data-api)
 */

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
    // Get network mode from cookies (matches NETWORK_COOKIE_NAME from network-mode.ts)
    const cookieStore = await cookies()
    const networkModeCookie = cookieStore.get('alphix-network-mode')
    const networkMode = networkModeCookie?.value === 'testnet' ? 'testnet' : 'mainnet'

    // Resolve base URL with Vercel fallback for preview deployments
    // Priority: NEXT_PUBLIC_APP_URL > VERCEL_URL (auto-set by Vercel)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)

    if (!baseUrl) {
      throw new Error(
        'NEXT_PUBLIC_APP_URL environment variable is required for GraphQL resolvers. ' +
        'Set it to http://localhost:3000 in .env.local for development.'
      )
    }

    return {
      networkMode,
      request,
      baseUrl,
    }
  },
})

async function rateLimitedHandler(request: Request) {
  const rateLimited = await checkRateLimit(request)
  if (rateLimited) return rateLimited
  return handleRequest(request)
}

export { rateLimitedHandler as GET, rateLimitedHandler as POST }
