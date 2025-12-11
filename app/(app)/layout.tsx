"use client"

import type React from "react"
import AppKitProvider from '@/components/AppKitProvider'
import { ThemeProvider } from "@/components/theme-provider"
import { NetworkProvider } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SidebarProvider } from "@/components/ui/sidebar"
import { useEffect, useState } from "react"

// Client component to handle cookie-based initialization
function AppProviders({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [wagmiCookie, setWagmiCookie] = useState<string>('')
  const [initialNetworkMode, setInitialNetworkMode] = useState<'mainnet' | 'testnet'>('mainnet')

  useEffect(() => {
    // Get cookies on client side
    const cookies = document.cookie
    setWagmiCookie(cookies)

    // Parse network mode from cookie
    const networkCookie = cookies
      .split('; ')
      .find(row => row.startsWith('alphix-network-mode='))
      ?.split('=')[1]

    const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
    const mode = (networkCookie === 'mainnet' || networkCookie === 'testnet')
      ? networkCookie as 'mainnet' | 'testnet'
      : envDefault

    setInitialNetworkMode(mode)
    setMounted(true)
  }, [])

  // Show nothing while mounting to avoid hydration mismatch
  if (!mounted) {
    return (
      <div style={{ backgroundColor: '#0f0f0f', minHeight: '100vh' }} />
    )
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <NetworkProvider initialNetworkMode={initialNetworkMode}>
        <AppKitProvider cookies={wagmiCookie}>
          <ErrorBoundary>
            <SidebarProvider>
              {children}
            </SidebarProvider>
          </ErrorBoundary>
        </AppKitProvider>
        <Toaster position="top-right" />
        <Analytics />
        <SpeedInsights />
      </NetworkProvider>
    </ThemeProvider>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>
}
