"use client"

import React from 'react'
import { useAccount } from 'wagmi'
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"

// Connect Wallet Button component
export function ConnectWalletButton() {
  const { isConnected } = useAccount()

  if (isConnected) {
    return null // Don't show connect button when already connected
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className="list-none"> 
        <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
          {/* @ts-expect-error custom element provided by wallet kit */}
          <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
          <span className="relative z-0 pointer-events-none">Connect Wallet</span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
