"use client"

import { useState, useRef } from "react"
import { PlusCircleIcon, /* LockIcon, */ type LucideIcon } from "lucide-react"
import { CustomLockIcon } from "./CustomLockIcon"

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavMainItem {
  title: string
  url?: string
  icon?: LucideIcon
  disabled?: boolean
}

export function NavMain({
  items,
}: {
  items: NavMainItem[]
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

  return (
    <SidebarMenu className="mt-2 flex flex-col gap-2">
      {items.map((item) => (
        <SidebarMenuItem key={item.title} className="list-none">
          {item.disabled ? (
            <SidebarMenuButton
              onClick={() => handleLockedClick(item.title)}
              className="opacity-75 hover:bg-transparent w-full"
              tooltip={item.title}
            >
              {item.icon && <item.icon />}
              <span className="flex-1 truncate">{item.title}</span>
              {lockedItem === item.title && (
                <CustomLockIcon className="h-6 w-6 flex-shrink-0 text-muted-foreground" />
              )}
            </SidebarMenuButton>
          ) : item.title === "Swap" ? (
            <SidebarMenuButton
              tooltip="Swap"
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground w-full"
              asChild
            >
              <a href={item.url!}>
                {item.icon ? <item.icon /> : <PlusCircleIcon />}
                <span>Swap</span>
              </a>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton tooltip={item.title} asChild className="w-full">
              <a href={item.url!}>
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </a>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

