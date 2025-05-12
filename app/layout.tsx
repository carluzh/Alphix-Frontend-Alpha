import type React from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import AppKitProvider from '@/components/AppKitProvider'
import { config } from '@/lib/wagmiConfig'
import { cookieToInitialState } from 'wagmi'
import { headers } from 'next/headers'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"

// Load Inter font
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

export const metadata = {
  title: "Dashboard",
  description: "Dashboard application",
    generator: 'v0.dev'
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
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}