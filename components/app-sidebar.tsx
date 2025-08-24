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
import { Badge } from "@/components/ui/badge"
import { useRouter } from "next/navigation"; // Import useRouter
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

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
      title: "Portfolio",
      url: "/portfolio",
      icon: ChartPieIcon,
    },
    {
      title: "Faucet",
      icon: CoinsIcon,
      isFaucet: true,
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

export function AppSidebar({ variant = "floating", ...props }: React.ComponentProps<typeof Sidebar>) {
  const isMobile = useIsMobile()
  const { resolvedTheme } = useTheme()
  const router = useRouter(); // Initialize useRouter

  return (
    <Sidebar variant={variant} collapsible="offcanvas" {...props}>
      <SidebarHeader className="!pt-2.5">
        <SidebarMenu>
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton 
              // onClick={() => router.push('/')} // Remove onClick from button
              className="data-[slot=sidebar-menu-button]:!p-2 !pt-2.5 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-transparent active:bg-transparent"
            >
              <div className="flex items-center w-full justify-between">
                <a 
                  href="/" // Restore href
                  className="flex items-center"
                >
                  <img 
                    src="/Logo Type (white).svg"
                    alt="Alphix Logo"
                    className="h-6 w-28 text-sidebar-logo dark:block hidden"
                    loading="eager"
                  />
                  <img 
                    src="/Logo Type (black).svg"
                    alt="Alphix Logo"
                    className="h-6 w-28 text-sidebar-logo block dark:hidden"
                    loading="eager"
                  />
                </a>
                <div onClick={(e) => e.stopPropagation()}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="bg-[#3d271b] text-sidebar-primary border-sidebar-primary rounded-md font-normal hover:bg-[#4a2f1f] transition-colors cursor-default"
                          style={{ fontFamily: 'Consolas, monospace' }}
                        >
                          Beta
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs" style={{ fontFamily: 'Consolas, monospace' }}>
                        1.0
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
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

