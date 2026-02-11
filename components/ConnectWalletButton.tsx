"use client"

import React from 'react'
import { useAccount } from 'wagmi'
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { appKit } from "@/components/AppKitProvider"

// Connect Wallet Button component
export function ConnectWalletButton() {
  const { isConnected } = useAccount()

  const handleConnect = () => {
    appKit?.open()
  }

  if (isConnected) {
    return null // Don't show connect button when already connected
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className="list-none">
        <button
          type="button"
          onClick={handleConnect}
          className="flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
          style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Connect Wallet
        </button>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
