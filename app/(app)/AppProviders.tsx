'use client'

import type React from "react"
import { useMemo } from "react"
import AppKitProvider from '@/components/AppKitProvider'
import { ThemeProvider } from "@/components/theme-provider"
import { NetworkProvider, type NetworkMode } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SidebarProvider } from "@/components/ui/sidebar"

export default function AppProviders({
  children,
  cookieString,
  initialNetworkMode,
}: {
  children: React.ReactNode
  cookieString: string
  initialNetworkMode: NetworkMode
}) {
  // Avoid re-computing the cookie string prop through renders (client-side navigations)
  const cookies = useMemo(() => cookieString, [cookieString])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <NetworkProvider initialNetworkMode={initialNetworkMode}>
        <AppKitProvider cookies={cookies}>
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


