import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
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
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning style={{ backgroundColor: '#0f0f0f' }}>
      <body style={{ backgroundColor: '#0f0f0f' }}>
        {children}
      </body>
    </html>
  )
}
