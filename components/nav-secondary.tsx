"use client"

import { useState, useRef, useEffect } from "react"
import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import { SunIcon, MoonIcon, LaptopIcon, Trash2Icon, SettingsIcon, LogOutIcon, CheckIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { CustomLockIcon } from "./CustomLockIcon"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavSecondaryItem {
  title: string;
  url: string;
  icon: LucideIcon;
  disabled?: boolean;
}

export function NavSecondary({
  items,
  ...props
}: {
  items: NavSecondaryItem[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { setTheme, resolvedTheme } = useTheme()

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
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu className="flex flex-col gap-1 px-3">
          {items.map((item) => (
            <SidebarMenuItem key={item.title} className="list-none">
              {item.title === "Settings" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton className="focus-visible:ring-0">
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent 
                      side="top" 
                      align="center"
                      sideOffset={4}
                      className="w-56 rounded-lg border-sidebar-accent"
                      style={{ backgroundColor: '#09090b' }}
                    >
                      <DropdownMenuItem onClick={() => {
                        const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
                        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
                      }} className="cursor-pointer">
                        {resolvedTheme === 'dark' ? (
                          <MoonIcon className="mr-2 h-4 w-4" />
                        ) : (
                          <SunIcon className="mr-2 h-4 w-4" />
                        )}
                        <span>Theme</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        localStorage.clear();
                        toast(
                          <span className="flex items-center">
                            <Trash2Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                            <span>Cache Cleared</span>
                          </span>
                        );
                      }} className="cursor-pointer">
                        <Trash2Icon className="mr-2 h-4 w-4" />
                        <span>Clean Cache</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              ) : item.disabled ? (
                <SidebarMenuButton
                  onClick={() => handleLockedClick(item.title)}
                  className="opacity-75 w-full flex items-center"
                  tooltip={item.title}
                >
                  {item.icon && <item.icon />}
                  <span className="flex-1 truncate">{item.title}</span>
                  {lockedItem === item.title && (
                    <span className="flex items-center">
                      <CustomLockIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground animate-pulse mr-0.5" />
                      <span className="text-[10px] text-muted-foreground animate-pulse">Soon</span>
                    </span>
                  )}
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild className="w-full flex items-center" tooltip={item.title}>
                  <a href={item.url} className="w-full flex items-center">
                    {item.icon && <item.icon />}
                    <span className="flex-1 truncate">{item.title}</span>
                  </a>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

