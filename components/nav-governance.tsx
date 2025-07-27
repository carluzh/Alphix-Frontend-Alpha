"use client"

import { useState, useRef, useEffect } from "react"
import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
} from "@/components/ui/sidebar"
import { CustomLockIcon } from "./CustomLockIcon"

interface NavGovernanceItem {
  title: string
  url?: string
  icon?: LucideIcon
  disabled?: boolean
}

export function NavGovernance({
  items,
  className,
}: {
  items: NavGovernanceItem[]
  className?: string
}) {
  const [lockedItem, setLockedItem] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleLockedClick = (itemName: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setLockedItem(itemName)
    timeoutRef.current = setTimeout(() => {
      setLockedItem(null)
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <SidebarGroup className={className}>
      <div 
        className="flex h-8 shrink-0 items-center rounded-md px-4 text-xs font-normal text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0"
      >
        Governance
      </div>
      <SidebarMenu className="mt-1 flex flex-col gap-1 px-3">
        {items.map((item) => (
          <SidebarMenuItem key={item.title} className="list-none">
            <SidebarMenuButton
              onClick={() => item.disabled && handleLockedClick(item.title)}
              className="opacity-75 w-full flex items-center"
              tooltip={item.title}
            >
              {item.icon && <item.icon />}
              <span className="flex-1 truncate">{item.title}</span>
              {item.disabled && lockedItem === item.title && (
                <span className="flex items-center">
                  <CustomLockIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground animate-pulse mr-0.5" />
                  <span className="text-[10px] text-muted-foreground animate-pulse">Soon</span>
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
} 