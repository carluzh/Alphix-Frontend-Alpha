/**
 * New AppKit Provider with improved React Query configuration
 * Drop-in replacement for the existing AppKitProvider
 */

'use client'

import { config, wagmiAdapter, projectId, baseSepolia } from '@/lib/wagmiConfig'
import { createAppKit } from '@reown/appkit'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import React, { type ReactNode, useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { cookieToInitialState } from 'wagmi'
import { queryClient } from '@/lib/cache/client/query-client'

/**
 * New AppKit Provider with properly configured React Query
 */
function AppKitProviderV2({
  children,
  cookies,
}: {
  children: ReactNode
  cookies: string | null
}) {
  const initialState = cookieToInitialState(config, cookies ?? '')

  // Initialize AppKit inside useEffect to run once on mount
  useEffect(() => {
    if (!projectId) {
      console.error('[AppKitProvider Init] NEXT_PUBLIC_PROJECT_ID is not set.')
      return
    }

    const metadata = {
      name: 'Alphix',
      description: 'Alphix Frontend with WalletConnect',
      url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
      icons: ['/favicon.ico'],
    }

    console.log('[AppKitProvider] Initializing AppKit...')
    createAppKit({
      adapters: [wagmiAdapter],
      projectId: projectId,
      networks: [baseSepolia],
      defaultNetwork: baseSepolia,
      metadata,
      features: {
        analytics: true,
        email: false,
        socials: [],
      },
      themeMode: 'dark',
      themeVariables: {},
    })
  }, [])

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
        {/* Add React Query DevTools in development */}
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} position="bottom-right" />
        )}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default AppKitProviderV2
