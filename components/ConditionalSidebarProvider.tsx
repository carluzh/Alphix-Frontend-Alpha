"use client"

import { usePathname } from "next/navigation"
import { SidebarProvider } from "@/components/ui/sidebar"
import type React from "react"

export function ConditionalSidebarProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Marketing/standalone pages that don't need sidebar layout
  const isMarketingPage = pathname === '/' || pathname === '/brand'

  // If it's a marketing page, just return children without SidebarProvider
  if (isMarketingPage) {
    return <>{children}</>
  }

  // App pages get the SidebarProvider wrapper
  return <SidebarProvider>{children}</SidebarProvider>
}
