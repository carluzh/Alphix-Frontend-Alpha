"use client"

import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import { SunIcon, MoonIcon, LaptopIcon, CoinsIcon, Trash2Icon, SettingsIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

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

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string
    url: string
    icon: LucideIcon
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { setTheme } = useTheme()

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.title === "Settings" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent 
                      side="top" 
                      align="center"
                      sideOffset={4}
                      className="w-56 rounded-lg"
                    >
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <SunIcon className="mr-2 h-4 w-4" />
                          <span>Theme</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer">
                              <SunIcon className="mr-2 h-4 w-4" />
                              <span>Light</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer">
                              <MoonIcon className="mr-2 h-4 w-4" />
                              <span>Dark</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer">
                              <LaptopIcon className="mr-2 h-4 w-4" />
                              <span>System</span>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Debug</DropdownMenuLabel>
                      <DropdownMenuItem className="cursor-pointer">
                        <CoinsIcon className="mr-2 h-4 w-4" />
                        <span>Faucet</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              ) : (
                <SidebarMenuButton asChild>
                  <a href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
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

