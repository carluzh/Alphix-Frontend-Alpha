import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query'
import { DISABLE_CACHE_PERSISTENCE, AlphixCacheKey } from './cacheKeys'

/**
 * Dehydration options matching Uniswap's sharedDehydrateOptions pattern.
 * Controls which queries get persisted to localStorage.
 *
 * Reference: interface/packages/uniswap/src/data/apiClients/sharedDehydrateOptions.ts
 */
export const alphixDehydrateOptions = {
  shouldDehydrateQuery: (query: Query): boolean => {
    // Skip queries with gcTime === 0 (approval checks, etc.)
    // These are intentionally not cached
    if (query.gcTime === 0) {
      return false
    }

    // Skip queries in the exclusion list
    if (
      query.queryKey.length > 0 &&
      typeof query.queryKey[0] === 'string' &&
      DISABLE_CACHE_PERSISTENCE.includes(query.queryKey[0] as AlphixCacheKey)
    ) {
      return false
    }

    // Use default behavior for everything else
    // This checks query.state.status === 'success' among other things
    return defaultShouldDehydrateQuery(query)
  },
}
