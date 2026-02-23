'use client'

import type React from "react"
import { useEffect } from "react"
import * as Sentry from '@sentry/nextjs'
import AppKitProvider from '@/components/AppKitProvider'
import { NetworkProvider, type NetworkMode } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { ConditionalAnalytics } from '@/components/ConditionalAnalytics'
import ErrorBoundary from '@/components/ErrorBoundary'
import { SidebarProvider } from "@/components/ui/sidebar"
import { SSEProvider } from "@/lib/realtime"
import { WebSocketProvider } from "@/lib/websocket"
import { NavigationProgressProvider } from "@/lib/navigation-progress"

/**
 * Check if an error is a wallet provider error (EIP-1193)
 * These have a code property with standard error codes
 */
function isWalletProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  // Check for EIP-1193 error codes
  if (typeof err.code === 'number') {
    // 4001 = user rejected, 4100 = unauthorized, 4200 = unsupported method
    // 4900 = disconnected, 4901 = chain disconnected
    // -32xxx = JSON-RPC errors
    return [4001, 4100, 4200, 4900, 4901].includes(err.code) ||
           (err.code <= -32000 && err.code >= -32099) ||
           err.code === -32002; // Request pending
  }
  // Check for wallet-related message patterns
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    return msg.includes('user rejected') ||
           msg.includes('user denied') ||
           msg.includes('metamask') ||
           msg.includes('wallet') ||
           msg.includes('connector');
  }
  return false;
}

export default function AppProviders({
  children,
  cookieString,
  initialNetworkMode,
}: {
  children: React.ReactNode
  cookieString: string
  initialNetworkMode: NetworkMode
}) {
  // Global handler for unhandled promise rejections from wallet interactions
  // This catches errors that escape try/catch blocks (e.g., from wagmi internals)
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;

      // Check if this is a wallet provider error
      if (isWalletProviderError(error)) {
        // Log it properly with Sentry context
        Sentry.withScope((scope) => {
          scope.setTag('error_source', 'wallet_provider');
          scope.setTag('handled_by', 'global_rejection_handler');

          // Extract error details
          const errorObj = error as Record<string, unknown>;
          scope.setExtras({
            code: errorObj.code,
            message: errorObj.message,
            data: errorObj.data,
            stack: errorObj.stack,
          });

          // Convert to proper Error for Sentry
          const wrappedError = new Error(
            typeof errorObj.message === 'string'
              ? errorObj.message
              : 'Wallet provider error'
          );
          wrappedError.name = 'WalletProviderError';

          Sentry.captureException(wrappedError);
        });

        // Prevent the default unhandled rejection behavior
        // since we've now handled it
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Capture referral code from URL on any page and store in localStorage
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const refCode = urlParams.get("ref")
    if (refCode) {
      localStorage.setItem("alphix_pending_referral", refCode)
      // Clean URL by removing the ref param
      const newUrl = window.location.pathname
      window.history.replaceState({}, "", newUrl)
    }
  }, [])

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
