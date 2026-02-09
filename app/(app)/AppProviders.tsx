'use client'

import type React from "react"
import { useEffect } from "react"
import AppKitProvider from '@/components/AppKitProvider'
import { NetworkProvider, type NetworkMode } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { ConditionalAnalytics } from '@/components/ConditionalAnalytics'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SidebarProvider } from "@/components/ui/sidebar"
import { SSEProvider } from "@/lib/realtime"
import { WebSocketProvider } from "@/lib/websocket"
import { NavigationProgressProvider } from "@/lib/navigation-progress"

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
    <NetworkProvider initialNetworkMode={initialNetworkMode}>
      <AppKitProvider cookies={cookieString}>
        <SSEProvider>
          <WebSocketProvider>
            <ErrorBoundary>
              <NavigationProgressProvider>
                <SidebarProvider>
                  {children}
                </SidebarProvider>
              </NavigationProgressProvider>
            </ErrorBoundary>
          </WebSocketProvider>
        </SSEProvider>
      </AppKitProvider>
      <Toaster position="top-right" />
      <ConditionalAnalytics />
    </NetworkProvider>
  )
}
