import type React from "react"
import { headers } from "next/headers"
import AppProviders from "./AppProviders"
import { getNetworkModeFromCookies } from "@/lib/network-mode"
import { AppLayout as AppShell } from "@/components/app-layout"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieString = (await headers()).get('cookie') ?? ''
  const cookieMode = getNetworkModeFromCookies(cookieString)
  const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
  const initialNetworkMode = cookieMode ?? envDefault

  return (
    <AppProviders cookieString={cookieString} initialNetworkMode={initialNetworkMode}>
      <AppShell>{children}</AppShell>
    </AppProviders>
  )
}
