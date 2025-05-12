"use client"

import { useState } from "react"
import { MoreHorizontalIcon, LockIcon, type LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function NavDisabledItems({
  items,
}: {
  items: {
    name: string
    // url is no longer needed as these are locked
    icon: LucideIcon
  }[]
}) {
  const { isMobile } = useSidebar()
  const [lockedItem, setLockedItem] = useState<string | null>(null)

  const handleLockedClick = (itemName: string) => {
    setLockedItem(itemName)
    setTimeout(() => {
      setLockedItem(null)
    }, 1000) // Show lock for 1 second
  }

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.name} className="list-none">
          <SidebarMenuButton 
            onClick={() => handleLockedClick(item.name)} 
            className="opacity-75 hover:bg-transparent"
          >
            <item.icon />
            <span className="flex-1 truncate">{item.name}</span>
            {lockedItem === item.name && (
              <LockIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground animate-pulse" />
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

