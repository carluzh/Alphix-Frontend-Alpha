"use client"

import type * as React from "react"
import { useEffect, useState } from "react"
import {
  BarChartIcon,
  ClipboardListIcon,
  HelpCircleIcon,
  LockIcon,
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
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useRouter } from "next/navigation"; // Import useRouter
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronRight } from "lucide-react"

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
  const [showVersionInitial, setShowVersionInitial] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const flag = sessionStorage.getItem('came_from_login');
        if (flag === '1' || flag === 'true') {
          setShowVersionInitial(true);
          try { sessionStorage.removeItem('came_from_login'); } catch {}
          const timer = setTimeout(() => setShowVersionInitial(false), 1000);
          return () => clearTimeout(timer);
        }
      } catch {}
    }
  }, []);

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
                  {/* Show 'Beta' by default; on hover swap to version text without resizing */}
                  <Badge
                    variant="outline"
                    className="bg-[#3d271b] text-sidebar-primary border-sidebar-primary rounded-md font-normal hover:bg-[#4a2f1f] transition-colors cursor-default inline-block group"
                    style={{ fontFamily: 'Consolas, monospace' }}
                    title="Version 1.0"
                  >
                    {showVersionInitial ? (
                      <span className="inline-flex items-center justify-center" style={{ minWidth: 28 }}>1.0</span>
                    ) : (
                      <span className="inline-flex items-center justify-center" style={{ minWidth: 28 }}>
                        <span className="group-hover:hidden">Beta</span>
                        <span className="hidden group-hover:inline">1.0</span>
                      </span>
                    )}
                  </Badge>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavGovernance items={data.navGovernance} className="mt-4" />
        <div className="mt-auto space-y-2">
          {/* Resources collapsible (contains Settings + Documentation) */}
          <Collapsible defaultOpen={false} className="group/resources">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="w-full px-3 flex items-center">
                  Resources
                  <ChevronRight className="ml-auto transition-transform duration-200 ease-in-out group-data-[state=open]/resources:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent
                className="overflow-hidden data-[state=closed]:max-h-0 data-[state=open]:max-h-[6rem] transition-[max-height,opacity,transform] duration-200 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100 data-[state=closed]:-translate-y-1 data-[state=open]:translate-y-0"
                style={{ willChange: 'maxHeight, opacity, transform' }}
              >
                <SidebarGroupContent className="pl-3">
                  <SidebarMenu>
                    <SidebarMenuItem className="list-none">
                      <SidebarMenuButton asChild size="sm" className="h-7">
                        <a href="https://github.com/alphixfi" target="_blank" rel="noopener noreferrer" className="w-full flex items-center">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.98 3.22 9.2 7.69 10.69.56.1.77-.24.77-.54 0-.27-.01-1-.02-1.97-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .72 2.62.51 3.25.39.1-.3.39-.51.71-.63-2.5-.28-5.12-1.25-5.12-5.55 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.41.11-2.94 0 0 .95-.3 3.12 1.16.9-.25 1.86-.38 2.82-.38.96 0 1.92.13 2.82.38 2.17-1.46 3.12-1.16 3.12-1.16.61 1.53.23 2.66.11 2.94.72.8 1.16 1.8 1.16 3.03 0 4.31-2.62 5.27-5.12 5.55.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.21.65.78.54 4.47-1.5 7.69-5.72 7.69-10.7C23.25 5.48 18.27.5 12 .5z" fill="currentColor"/>
                          </svg>
                          <span>GitHub</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="list-none">
                      <SidebarMenuButton asChild size="sm" className="h-7 opacity-80">
                        <a href="#" className="w-full flex items-center">
                          <HelpCircleIcon className="h-4 w-4" />
                          <span>Documentation</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          {/* Socials group (collapsible, at bottom, expands downward, pushes Resources up) */}
          <Collapsible defaultOpen={false} className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="w-full px-3 flex items-center">
                  Socials
                  <ChevronRight className="ml-auto transition-transform duration-200 ease-in-out group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent
                className="overflow-hidden data-[state=closed]:max-h-0 data-[state=open]:max-h-[6rem] transition-[max-height,opacity,transform] duration-200 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100 data-[state=closed]:-translate-y-1 data-[state=open]:translate-y-0"
                style={{ willChange: 'maxHeight, opacity, transform' }}
              >
                <SidebarGroupContent className="pl-3">
                  <SidebarMenu>
                    <SidebarMenuItem className="list-none">
                      <SidebarMenuButton asChild size="sm" className="h-7">
                        <a href="https://x.com/AlphixFi" target="_blank" rel="noopener noreferrer">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/>
                          </svg>
                          <span>Twitter</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="list-none">
                      <SidebarMenuButton asChild size="sm" className="h-7">
                        <a href="https://discord.gg/NTXRarFbTr" target="_blank" rel="noopener noreferrer">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5499-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" fill="currentColor"/>
                          </svg>
                          <span>Discord</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
          {/* Resources/Settings area is nudged up when Socials opens to make room */}
          <div className="transition-transform duration-200 transform-gpu" style={{ willChange: 'transform' }}>
            <div className="group-data-[state=open]/collapsible:-translate-y-2 transition-transform duration-200 ease-in-out">
              {/* keep other secondary nav items if any; Resources already includes Settings/Docs */}
            </div>
          </div>
        </div>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <AccountStatus />
      </SidebarFooter>
    </Sidebar>
  )
}

