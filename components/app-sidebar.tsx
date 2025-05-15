"use client"

import type * as React from "react"
import {
  BarChartIcon,
  ClipboardListIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  LockIcon,
  SettingsIcon,
  TrendingUpIcon,
  ArrowRightLeftIcon,
  LayersIcon,
} from "lucide-react"
import { ReactSVG } from "react-svg"
import { NavDisabledItems } from "./nav-governance"
import { NavMain } from "./nav-main"
import { NavSecondary } from "./nav-secondary"
import { AccountStatus } from "./AccountStatus"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  user: {
    name: "Wallet 1",
    address: "0x1234...5678",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Swap",
      url: "/swap",
      icon: ArrowRightLeftIcon,
    },
    {
      title: "Dashboard",
      icon: LayoutDashboardIcon,
      disabled: true,
    },
    {
      title: "Liquidity",
      url: "/liquidity",
      icon: LayersIcon,
    },
    {
      title: "Analytics",
      icon: BarChartIcon,
      disabled: true,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: SettingsIcon,
    },
    {
      title: "Documentation",
      url: "#",
      icon: HelpCircleIcon,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton 
              asChild 
              className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <a href="/dashboard">
                <div className="flex items-center">
                  <ReactSVG 
                    src="/logo.svg" 
                    className="h-6 w-28 text-slate-900 dark:text-white"
                  />
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="p-2">
        <AccountStatus />
      </SidebarFooter>
    </Sidebar>
  )
}

