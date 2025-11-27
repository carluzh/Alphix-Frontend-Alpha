import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import AppKitProvider from '@/components/AppKitProvider'
import { config } from '@/lib/wagmiConfig'
import { cookieToInitialState } from 'wagmi'
import { headers } from 'next/headers'
import { ThemeProvider } from "@/components/theme-provider"
import { NetworkProvider } from "@/lib/network-context"
import { Toaster } from "@/components/ui/sonner"
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import ErrorBoundary from '@/components/ErrorBoundary'
import type { Metadata } from 'next'
import { SidebarProvider } from "@/components/ui/sidebar"

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

// Make the layout component async to await headers
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Await the headers
  const headerList = await headers()
  const cookie = headerList.get("cookie")
  // Pass cookie to initial state helper
  const initialWagmiState = cookieToInitialState(config, cookie)

  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NetworkProvider>
            <AppKitProvider cookies={cookie}>
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