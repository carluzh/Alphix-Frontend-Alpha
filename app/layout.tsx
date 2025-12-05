import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import AppKitProvider from '@/components/AppKitProvider'
import { ThemeProvider } from "@/components/theme-provider"
import { NetworkProvider } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import ErrorBoundary from '@/components/ErrorBoundary'
import type { Metadata } from 'next'
import { SidebarProvider } from "@/components/ui/sidebar"
import { cookies } from "next/headers"

// Load Inter font
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: {
    default: 'Alphix',
    template: 'Alphix | %s',
  },
  description: 'Alphix: Unifying Liquidity on Base. Enhancing DeFi capital efficiency with our dynamic fee hook. Built on Uniswap V4 for security and optimal performance. Explore Unified Pools today!',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const wagmiCookie = cookieStore.getAll()
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  const networkCookie = cookieStore.get('alphix-network-mode');
  // Use env var default for new users without a cookie preference
  const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const initialNetworkMode = (networkCookie?.value === 'mainnet' || networkCookie?.value === 'testnet')
    ? networkCookie.value as 'mainnet' | 'testnet'
    : envDefault;

  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning style={{ backgroundColor: '#0f0f0f' }}>
      <body style={{ backgroundColor: '#0f0f0f' }}>
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
      </body>
    </html>
  );
}