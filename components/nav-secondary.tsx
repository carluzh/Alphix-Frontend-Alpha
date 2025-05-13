"use client"

import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import { SunIcon, MoonIcon, LaptopIcon, CoinsIcon, Trash2Icon, SettingsIcon, LogOutIcon } from "lucide-react"
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
                      <DropdownMenuItem 
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/logout', { method: 'POST' });
                            if (res.ok) {
                              toast(
                                <span className="flex items-center">
                                  <LogOutIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                                  <span>Session Reset. Redirecting to login...</span>
                                </span>
                              );
                              setTimeout(() => {
                                window.location.href = '/login';
                              }, 1500);
                            } else {
                              toast(
                                <span className="flex items-center">
                                  <span>Failed to reset session.</span>
                                </span>
                              );
                            }
                          } catch (error) {
                            console.error("Failed to reset session:", error);
                            toast(
                              <span className="flex items-center">
                                <span>Error resetting session.</span>
                              </span>
                            );
                          }
                        }}
                        className="cursor-pointer"
                      >
                        <LogOutIcon className="mr-2 h-4 w-4" />
                        <span>Reset Session</span>
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

