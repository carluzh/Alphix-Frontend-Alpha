"use client"

import type * as React from "react"
import {
  BarChartIcon,
  ClipboardListIcon,
  HelpCircleIcon,
  LockIcon,
  SettingsIcon,
  TrendingUpIcon,
  ArrowRightLeftIcon,
  LayersIcon,
  GiftIcon,
  BriefcaseIcon,
  TrophyIcon,
  ChartPieIcon,
  AwardIcon,
  KeySquareIcon,
  GaugeIcon,
  CoinsIcon,
} from "lucide-react"
import { ReactSVG } from "react-svg"
import { useTheme } from "next-themes"
import { NavMain } from "./nav-main"
import { NavSecondary } from "./nav-secondary"
import { NavGovernance } from "./nav-governance"
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
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

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
      title: "Liquidity",
      url: "/liquidity",
      icon: LayersIcon,
    },
    {
      title: "Faucet",
      icon: CoinsIcon,
      isFaucet: true,
    },
    {
      title: "Portfolio",
      icon: ChartPieIcon,
      disabled: true,
    },
  ],
  navGovernance: [
    {
      title: "Lock",
      icon: KeySquareIcon,
      url: "#",
      disabled: true,
    },
    {
      title: "Vote",
      icon: ClipboardListIcon,
      url: "#",
      disabled: true,
    },
    {
      title: "Gauges",
      icon: GaugeIcon,
      url: "#",
      disabled: true,
    },
    {
      title: "Leaderboard",
      icon: AwardIcon,
      url: "#",
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
      disabled: true,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const isMobile = useIsMobile()
  const { resolvedTheme } = useTheme()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton 
              asChild 
              className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            >
              <a 
                href="/" 
                className={cn(isMobile && "pt-4")}
              >
                <div className="flex items-center">
                  <ReactSVG 
                    src={resolvedTheme === "dark" ? "/Logo Type (white).svg" : "/Logo Type (black).svg"}
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
        <NavGovernance items={data.navGovernance} className="mt-4" />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="p-2">
        <AccountStatus />
      </SidebarFooter>
    </Sidebar>
  )
}

