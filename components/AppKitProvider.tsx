'use client'

// Import config, adapter, networks etc. needed for BOTH provider and init
import { config, wagmiAdapter, projectId, networks as wagmiNetworks, baseSepolia } from '@/lib/wagmiConfig' 
import { createAppKit } from '@reown/appkit'
// Removed import of non-existent provider
// Import AppKit networks separately for initialization
import { mainnet as appKitMainnet, arbitrum as appKitArbitrum, sepolia as appKitSepolia, polygon as appKitPolygon } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode, useEffect, useState } from 'react'
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
      staleTime: 0, // Default to always refetch unless hook overrides
      gcTime: 10 * 60 * 1000,
      networkMode: 'online',
    },
  },
})

// Renamed component back to original
function AppKitProvider({ children, cookies }: { children: ReactNode, cookies: string | null }) {
  const initialState = cookieToInitialState(config, cookies ?? '')
  const [appkitReady, setAppkitReady] = useState(false)

  // Initialize AppKit inside useEffect to run once on mount
  useEffect(() => {
    if (!projectId) {
      console.error('[AppKitProvider Init] NEXT_PUBLIC_PROJECT_ID is not set.')
      setAppkitReady(true) // Allow render even if no projectId (for development)
      return
    }

    const metadata = {
      name: 'Alphix Example',
      description: 'Alphix Frontend Example with WalletConnect',
      url: 'http://localhost:3000',
      icons: ['/favicon.ico']
    }

    console.log("Initializing AppKit inside provider effect...")
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
      themeVariables: {
      }
    })

    // Mark AppKit as ready after initialization
    setAppkitReady(true)
  }, []) // Empty dependency array ensures this runs only once

  // Don't render children until AppKit is ready
  if (!appkitReady) {
    return null // or return a loading spinner if you prefer
  }

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