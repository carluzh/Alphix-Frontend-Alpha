'use client'

import type React from "react"
import { useEffect } from "react"
import AppKitProvider from '@/components/AppKitProvider'
import { ThemeProvider } from "@/components/theme-provider"
import { NetworkProvider, type NetworkMode } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SidebarProvider } from "@/components/ui/sidebar"
import { SSEProvider } from "@/lib/realtime"

export default function AppProviders({
  children,
  cookieString,
  initialNetworkMode,
}: {
  children: React.ReactNode
  cookieString: string
  initialNetworkMode: NetworkMode
}) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      document.documentElement.classList.add("is-resizing")
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        document.documentElement.classList.remove("is-resizing")
        t = null
      }, 150)
    }

    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      if (t) clearTimeout(t)
      document.documentElement.classList.remove("is-resizing")
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <NetworkProvider initialNetworkMode={initialNetworkMode}>
        <AppKitProvider cookies={cookieString}>
          <SSEProvider>
            <ErrorBoundary>
              <SidebarProvider>
                {children}
              </SidebarProvider>
            </ErrorBoundary>
          </SSEProvider>
        </AppKitProvider>
        <Toaster position="top-right" />
        <Analytics />
        <SpeedInsights />
      </NetworkProvider>
    </ThemeProvider>
  )
}
