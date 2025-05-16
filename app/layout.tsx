import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import AppKitProvider from '@/components/AppKitProvider'
import { config } from '@/lib/wagmiConfig'
import { cookieToInitialState } from 'wagmi'
import { headers } from 'next/headers'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import type { Metadata } from 'next'

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
    icon: '/Tab.png', 
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
          <AppKitProvider cookies={cookie}>
            {children}
          </AppKitProvider>
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}