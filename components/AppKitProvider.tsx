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
import { E2EAutoConnect } from '@/components/E2EAutoConnect'
import { E2EPoolStateProbe } from '@/components/E2EPoolStateProbe'

// Lazy-initialized AppKit instance — only created when AppKitProvider mounts
// (i.e. inside the (app) route group), so the marketing/landing page never triggers it.
let _appKit: ReturnType<typeof createAppKit> | null = null

export function initializeAppKit() {
  // E2E: skip Reown AppKit entirely. The WagmiProvider uses a plain fork-backed
  // wagmi config (lib/wagmiConfig.ts) and we auto-connect a mock connector, so
  // the AppKit modal/relay is unused — and initializing it would re-route the
  // mock's RPC to the WalletConnect relay. getAppKit() returning null is safe
  // (connect buttons call getAppKit()?.open() — a no-op when auto-connected).
  if (process.env.NEXT_PUBLIC_E2E === 'true') return null
  if (!_appKit && typeof window !== 'undefined' && projectId) {
    _appKit = createAppKit({
      adapters: [wagmiAdapter],
      projectId,
      networks: [appKitBase, appKitArbitrum],
      defaultNetwork: appKitBase,
      // Suppress AppKit's blocking "Switch Network" modal when a previously connected
      // wallet is on an unsupported chain. We handle mismatches ourselves via
      // ChainAutoSwitcher (app mount) + ensureChain() (transaction time).
      allowUnsupportedChain: true,
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
      <E2EAutoConnect />
      <PersistQueryClientProvider client={queryClient}>
        <ApolloProvider client={apolloClient}>
          <E2EPoolStateProbe />
          <TransactionProvider>
            {children}
          </TransactionProvider>
        </ApolloProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  )
}

export default AppKitProvider 