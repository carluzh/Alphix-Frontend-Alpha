"use client"

import { useState, useRef } from "react"
import { PlusCircleIcon, /* LockIcon, */ type LucideIcon } from "lucide-react"
import { CustomLockIcon } from "./CustomLockIcon"
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();

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
      {items.map((item) => {
        const isActive = item.url === pathname;

        return (
          <SidebarMenuItem key={item.title} className="list-none">
            {item.disabled ? (
              <SidebarMenuButton
                onClick={() => handleLockedClick(item.title)}
                className="opacity-75 hover:bg-transparent w-full flex items-center"
                tooltip={item.title}
              >
                {item.icon && <item.icon />}
                <span className="flex-1 truncate">{item.title}</span>
                {lockedItem === item.title && (
                  <span className="flex items-center">
                    <CustomLockIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground mr-0.5" />
                    <span className="text-[10px] text-muted-foreground">Soon</span>
                  </span>
                )}
              </SidebarMenuButton>
            ) : item.title === "Swap" ? (
              <SidebarMenuButton
                tooltip="Swap"
                className="w-full"
                asChild
                isActive={isActive}
              >
                <a href={item.url!} className="flex items-center w-full">
                  {item.icon ? <item.icon /> : <PlusCircleIcon />}
                  <span className="flex-1 truncate">Swap</span>
                </a>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton tooltip={item.title} asChild className="w-full" isActive={isActive}>
                <a href={item.url!} className="flex items-center w-full">
                  {item.icon && <item.icon />}
                  <span className="flex-1 truncate">{item.title}</span>
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  )
}

