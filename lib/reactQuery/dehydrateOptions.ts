import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query'

/**
 * Query key prefixes that should NOT be persisted to localStorage.
 * These are volatile server-state queries where stale cached data
 * causes visible bugs (zero-filled charts, stale fee lines, etc.).
 */
const VOLATILE_QUERY_PREFIXES: string[] = [
  'overview-chart',
  'positions-chart',
  'protocol-tvl-history',
  'token-prices-batch',
  'positionApr',
  'gasPrice',
  'zap-preview',
  'zap-approvals',
  'prepareMint',
  'balance',
  'unifiedYieldCompoundedFees',
]

function isVolatileQuery(query: Query): boolean {
  const key = query.queryKey
  if (!Array.isArray(key) || key.length === 0) return false
  const prefix = String(key[0])
  return VOLATILE_QUERY_PREFIXES.includes(prefix)
}

/**
 * Dehydration options — controls which queries get persisted to localStorage.
 *
 * Only genuinely-static data is persisted (aave rates, token metadata).
 * Volatile server-state (charts, prices, positions) is excluded to prevent
 * stale cached data from causing zero-filled charts or stale fee lines.
 */
export const alphixDehydrateOptions = {
  shouldDehydrateQuery: (query: Query): boolean => {
    // Skip queries with gcTime === 0 (approval checks, etc.)
    if (query.gcTime === 0) {
      return false
    }

    // Skip volatile queries — these must always be fresh from the server
    if (isVolatileQuery(query)) {
      return false
    }

    // Use default behavior for everything else
    // This checks query.state.status === 'success' among other things
    return defaultShouldDehydrateQuery(query)
  },
}
