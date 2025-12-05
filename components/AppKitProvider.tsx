'use client'

import { config, wagmiAdapter, projectId, isMainnet } from '@/lib/wagmiConfig'
import { createAppKit } from '@reown/appkit'
import { base as appKitBase, baseSepolia as appKitBaseSepolia } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { cookieToInitialState } from 'wagmi'

if (typeof window !== 'undefined' && projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks: [appKitBaseSepolia, appKitBase],
    defaultNetwork: isMainnet ? appKitBase : appKitBaseSepolia,
    metadata: {
      name: 'Alphix',
      description: 'Alphix AMM',
      url: window.location.origin,
      icons: ['/favicon.ico']
    },
    features: {
      analytics: true,
      email: false,
      socials: [],
    },
    themeMode: 'dark',
    themeVariables: {
      '--w3m-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      '--w3m-accent': '#FFFFFF',
      '--w3m-border-radius-master': '8px',
    }
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: false,
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      networkMode: 'online',
    },
  },
})

function AppKitProvider({ children, cookies }: { children: ReactNode, cookies: string | null }) {
  const initialState = cookieToInitialState(config, cookies ?? '')

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default AppKitProvider 