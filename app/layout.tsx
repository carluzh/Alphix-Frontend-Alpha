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

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://alphix.fi'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'Alphix | Building Smarter Onchain Markets',
    template: '%s | Alphix',
  },
  description: 'Alphix is a liquidity protocol on Base with dynamic fee hooks and unified liquidity through rehypothecation. Maximize capital efficiency with smarter onchain markets.',
  keywords: ['Base DEX', 'Base liquidity', 'DeFi on Base', 'liquidity protocol', 'dynamic fees', 'rehypothecation', 'unified liquidity', 'Alphix'],
  authors: [{ name: 'Alphix' }],
  creator: 'Alphix',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: baseUrl,
    siteName: 'Alphix',
    title: 'Alphix | Building Smarter Onchain Markets',
    description: 'Liquidity protocol on Base with dynamic fee hooks and unified liquidity through rehypothecation. Maximize capital efficiency.',
    images: [
      {
        url: '/card.png?v=1',
        width: 1200,
        height: 630,
        alt: 'Alphix - Building Smarter Onchain Markets',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alphix | Building Smarter Onchain Markets',
    description: 'Liquidity protocol on Base. Dynamic fees. Unified liquidity through rehypothecation.',
    images: ['/card.png?v=1'],
    creator: '@alphixfi',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
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
