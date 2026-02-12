'use client'

import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import {
  PersistQueryClientProvider as TanStackPersistProvider,
  type PersistQueryClientOptions,
} from '@tanstack/react-query-persist-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useMemo } from 'react'
import { alphixDehydrateOptions } from '@/lib/reactQuery/dehydrateOptions'
import { MAX_REACT_QUERY_CACHE_TIME_MS } from '@/lib/utils/time'
import { NETWORK_STORAGE_KEY } from '@/lib/network-mode'

type PersistOptions = Omit<PersistQueryClientOptions, 'queryClient'>

/**
 * Version buster - increment to invalidate entire cache.
 * Change this when making breaking changes to query data structures.
 */
const CACHE_BUSTER = 'v1'

interface PersistQueryClientProviderProps {
  client: QueryClient
  children: ReactNode
}

/**
 * OVERRIDE: Always use mainnet cache key (testnet removed)
 */
function getNetworkAwareCacheKey(): string {
  return 'alphix-rq-cache-mainnet'
}

/**
 * PersistQueryClientProvider - Wraps TanStack's PersistQueryClientProvider
 * to save React Query cache to localStorage.
 *
 * Features:
 * - Network-aware cache keys (mainnet vs testnet)
 * - SSR-safe (only creates persister on client)
 * - Cache buster for version invalidation
 * - Configurable max age (default: 24 days)
 *
 * Reference: interface/apps/web/src/components/PersistQueryClient.tsx
 */
export function PersistQueryClientProvider({
  client,
  children,
}: PersistQueryClientProviderProps) {
  const persistOptions = useMemo((): PersistOptions | undefined => {
    // Only create persister on client-side
    if (typeof window === 'undefined') {
      return undefined
    }

    const cacheKey = getNetworkAwareCacheKey()

    const persister = createSyncStoragePersister({
      storage: localStorage,
      key: cacheKey,
    })

    // Type cast needed due to Query type version mismatch between packages
    return {
      buster: CACHE_BUSTER,
      maxAge: MAX_REACT_QUERY_CACHE_TIME_MS, // 24 days from time.ts
      persister,
      dehydrateOptions: alphixDehydrateOptions,
    } as unknown as PersistOptions
  }, [])

  // SSR fallback - still provide QueryClient but skip persistence
  if (!persistOptions) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  return (
    <TanStackPersistProvider client={client} persistOptions={persistOptions}>
      {children}
    </TanStackPersistProvider>
  )
}
