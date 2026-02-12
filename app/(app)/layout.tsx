import type React from "react"
import { headers } from "next/headers"
import AppProviders from "./AppProviders"
import { getNetworkModeFromCookies } from "@/lib/network-mode"
import { AppLayout as AppShell } from "@/components/app-layout"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieString = (await headers()).get('cookie') ?? ''
  const cookieMode = getNetworkModeFromCookies(cookieString)
  // OVERRIDE: Always use mainnet (testnet removed)
  const initialNetworkMode = 'mainnet' as const

  return (
    <AppProviders cookieString={cookieString} initialNetworkMode={initialNetworkMode}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  )
}
