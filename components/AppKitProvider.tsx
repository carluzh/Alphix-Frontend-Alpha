'use client'

// Import config, adapter, networks etc. needed for BOTH provider and init
import { config, wagmiAdapter, projectId, isMainnet } from '@/lib/wagmiConfig'
import { createAppKit } from '@reown/appkit'
// Import AppKit networks for initialization
import { base as appKitBase, baseSepolia as appKitBaseSepolia } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode, useEffect } from 'react'
// Use WagmiProvider
import { WagmiProvider } from 'wagmi'
import { cookieToInitialState } from 'wagmi' 

// --- Removed AppKit Initialization from Module Level ---

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0, // Disable retries to prevent duplicate calls
      refetchOnWindowFocus: false,
      refetchOnMount: true, // Refetch only if stale (respects staleTime)
      refetchOnReconnect: false, // Disable refetch on reconnect
      staleTime: 2 * 60 * 1000, // 2min client-side cache (critical hooks override with shorter values)
      gcTime: 10 * 60 * 1000,
      networkMode: 'online',
    },
  },
})

// Renamed component back to original
function AppKitProvider({ children, cookies }: { children: ReactNode, cookies: string | null }) {
  const initialState = cookieToInitialState(config, cookies ?? '')

  useEffect(() => {
    if (!projectId) {
      console.error('[AppKitProvider Init] NEXT_PUBLIC_PROJECT_ID is not set.')
      return
    }

    const metadata = {
      name: 'Alphix Example',
      description: 'Alphix Frontend Example with WalletConnect',
      url: 'http://localhost:3000',
      icons: ['/favicon.ico']
    }

    createAppKit({
      adapters: [wagmiAdapter],
      projectId: projectId,
      networks: [appKitBaseSepolia, appKitBase], // Both Base Sepolia and Base Mainnet
      defaultNetwork: isMainnet ? appKitBase : appKitBaseSepolia, // Network based on stored preference
      metadata,
      features: {
        analytics: true,
        email: false,
        socials: [],
      },
      themeMode: 'dark',
      themeVariables: {
        '--w3m-font-family': 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }
    })
  }, [])

  return (
    // No extra AppKit provider needed here
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

// Export original name
export default AppKitProvider; 