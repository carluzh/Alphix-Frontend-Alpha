'use client'

import type React from "react"
import { useEffect } from "react"
import { useAccount } from "wagmi"
import { reportError, setWalletUser, clearWalletUser } from '@/lib/observability'
import { modeForChainId } from '@/lib/network-mode'
import AppKitProvider from '@/components/AppKitProvider'
import { ChainAutoSwitcher } from '@/components/ChainAutoSwitcher'
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

/**
 * Global Sentry wallet user context — wired ONCE (single source of truth).
 * Rendered INSIDE AppKitProvider (alongside ChainAutoSwitcher) so useAccount()
 * resolves against the wagmi context. On connect / chain-change it attaches the
 * connected wallet to every Sentry event; on disconnect it clears it. Never call
 * setWalletUser/clearWalletUser at error sites.
 */
function WalletSentryUser() {
  const { address, isConnected, chainId } = useAccount();
  useEffect(() => {
    if (isConnected && address) {
      const networkMode = chainId != null ? modeForChainId(chainId) : null;
      setWalletUser(address, chainId, networkMode);
    } else {
      clearWalletUser();
    }
  }, [address, isConnected, chainId]);
  return null;
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
        const errorObj = (error ?? {}) as Record<string, unknown>;
        const code = errorObj.code;

        // Non-actionable wallet/connector noise (user-reject + EIP-1193/JSON-RPC
        // codes from wagmi/AppKit internal async tasks we can't wrap). Don't report
        // it — the central beforeSend (isWalletRejection in sentry-init-shared) owns
        // dropping it; here we just silence the browser console. This eliminated a
        // ~63-event class of unhandled-rejection reports from /overview.
        const noiseCodes = [4001, 4100, 4200, 4900, 4901, -32002];
        const isRpcRange = typeof code === 'number' && code <= -32000 && code >= -32099;
        if ((typeof code === 'number' && noiseCodes.includes(code)) || isRpcRange) {
          event.preventDefault();
          return;
        }

        // Genuinely-novel wallet errors (unrecognised code) still report.
        reportError(error, {
          domain: 'wallet',
          action: 'unhandledRejection',
          fingerprint: ['wallet', 'unhandledRejection', String(code)],
          tags: {
            error_source: 'wallet_provider',
            handled_by: 'global_rejection_handler',
            code: typeof code === 'number' ? code : undefined,
          },
          extras: {
            code: errorObj.code,
            message: errorObj.message,
            data: errorObj.data,
            stack: errorObj.stack,
          },
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
  // Sanitize: only allow alphanumeric codes (4-32 chars) to prevent XSS via ?ref=
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const refCode = urlParams.get("ref")
    if (refCode) {
      if (/^[a-zA-Z0-9]{4,32}$/.test(refCode)) {
        localStorage.setItem("alphix_pending_referral", refCode)
      }
      // Always clean URL regardless of validity
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
    <AppKitProvider cookies={cookieString}>
      <ChainAutoSwitcher />
      <WalletSentryUser />
      <NetworkProvider initialNetworkMode={initialNetworkMode}>
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
        <Toaster position="top-right" />
        <ConditionalAnalytics />
      </NetworkProvider>
    </AppKitProvider>
  )
}
