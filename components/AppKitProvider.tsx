'use client'

import { config, wagmiAdapter, projectId } from '@/lib/wagmiConfig'
import { createAppKit } from '@reown/appkit'
import { base as appKitBase, arbitrum as appKitArbitrum } from '@reown/appkit/networks'
import { QueryClient } from '@tanstack/react-query'
import { ApolloProvider } from '@apollo/client'
import { type ReactNode } from 'react'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { FetchError } from '@/lib/utils/errors'
import { ONE_SECOND_MS, ONE_DAY_MS } from '@/lib/utils/time'
import { hashKey } from '@/lib/utils/hashKey'
import { apolloClient } from '@/lib/apollo/client'
import { PersistQueryClientProvider } from '@/components/PersistQueryClientProvider'
import { TransactionProvider } from '@/lib/transactions/TransactionProvider'

// Lazy-initialized AppKit instance — only created when AppKitProvider mounts
// (i.e. inside the (app) route group), so the marketing/landing page never triggers it.
let _appKit: ReturnType<typeof createAppKit> | null = null

export function initializeAppKit() {
  if (!_appKit && typeof window !== 'undefined' && projectId) {
    _appKit = createAppKit({
      adapters: [wagmiAdapter],
      projectId,
      networks: [appKitBase, appKitArbitrum],
      defaultNetwork: appKitBase,
      metadata: { name: 'Alphix', description: 'Alphix AMM', url: window.location.origin, icons: ['/favicon.ico'] },
      features: { analytics: true, email: false, socials: [] },
      themeMode: 'dark',
      themeVariables: { '--w3m-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', '--w3m-accent': '#FFFFFF', '--w3m-border-radius-master': '8px' }
    })
  }
  return _appKit
}

export function getAppKit() {
  return _appKit
}

// Identical to Uniswap SharedQueryClient.ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * ONE_SECOND_MS,
      gcTime: ONE_DAY_MS,
      retry: (failureCount, error): boolean => {
        if (failureCount < 2 && error instanceof FetchError && error.response.status === 500) return true
        return false
      },
      queryKeyHashFn: hashKey,
    },
  },
})

function AppKitProvider({ children, cookies }: { children: ReactNode, cookies: string | null }) {
  initializeAppKit()
  const initialState = cookieToInitialState(config, cookies ?? '')

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <PersistQueryClientProvider client={queryClient}>
        <ApolloProvider client={apolloClient}>
          <TransactionProvider>
            {children}
          </TransactionProvider>
        </ApolloProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  )
}

export default AppKitProvider 