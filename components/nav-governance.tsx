"use client"

import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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
  const handleLockedClick = () => {
    toast.info("Coming Soon")
  }

  return (
    <SidebarGroup className={className}>
      <div 
        className="flex h-8 shrink-0 items-center rounded-md px-4 text-xs font-normal text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0"
      >
        Governance
      </div>
      <SidebarMenu className="mt-1 flex flex-col gap-0.5 px-2">
        {items.map((item) => (
          <SidebarMenuItem key={item.title} className="list-none">
            <SidebarMenuButton
              onClick={() => item.disabled && handleLockedClick()}
              className={cn(
                "w-full flex items-center rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                "text-muted-foreground"
              )}
              tooltip={item.title}
            >
              {item.icon && <item.icon className="h-4 w-4 flex-shrink-0" />}
              <span className="flex-1 truncate ml-2 text-sm font-medium">{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
} 