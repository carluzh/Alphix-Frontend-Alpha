"use client"

import type * as React from "react"
import { useEffect, useState, useRef, useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  HelpCircleIcon,
} from "lucide-react"
import { IconHouse6Fill, IconStorage, IconChart, IconArrowsBoldOppositeDirection, IconSavedItems, IconCoins } from "nucleo-micro-bold-essential"
import { NavMain, type NavMainItem } from "./nav-main"
import { AccountStatus } from "./AccountStatus"
import { ConnectWalletButton } from "./ConnectWalletButton"
import { CustomLockIcon } from "./CustomLockIcon"
import { PointsIcon } from "./PointsIcons"
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
import { getLatestVersion } from "@/lib/version-log"
import { useNetwork } from "@/lib/network-context"

// Base navigation items (always shown)
const baseNavItems: NavMainItem[] = [
  {
    title: "Overview",
    url: "/overview",
    icon: IconHouse6Fill,
  },
  {
    title: "Liquidity",
    url: "/liquidity",
    icon: IconStorage,
  },
  {
    title: "Swap",
    url: "/swap",
    icon: IconArrowsBoldOppositeDirection,
  },
  {
    title: "Points",
    url: "/points",
    icon: PointsIcon,
  },
  {
    title: "Analytics",
    url: "/analytics",
    icon: IconChart,
    disabled: true,
  },
];

// Testnet-only navigation items
const testnetNavItems: NavMainItem[] = [
  {
    title: "Faucet",
    icon: IconCoins,
    isFaucet: true,
  },
];

const data = {
  user: {
    name: "Wallet 1",
    address: "0x1234...5678",
    avatar: "/avatars/shadcn.jpg",
  },
  navSecondary: [
    {
      title: "Documentation",
      url: "#",
      icon: HelpCircleIcon,
      disabled: true,
    },
  ],
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  onBetaClick?: () => void;
}

const BETA_BADGE_STORAGE_KEY = "alphix:betaBadge:lastSeenVersion";

export function AppSidebar({ variant = "floating", onBetaClick, ...props }: AppSidebarProps) {
  const isMobile = useIsMobile()
  const router = useRouter(); // Initialize useRouter
  const { isTestnet } = useNetwork();
  const [showVersionInitial, setShowVersionInitial] = useState(false);
  const [badgeHovered, setBadgeHovered] = useState(false);
  const [lockedItem, setLockedItem] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Build navigation items based on network mode
  const navMain = useMemo(() => {
    if (isTestnet) {
      return [...baseNavItems, ...testnetNavItems];
    }
    return [...baseNavItems];
  }, [isTestnet]);

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
  
  // Get latest version info
  const latestVersion = getLatestVersion();
  const [isRecentRelease, setIsRecentRelease] = useState(false);
  const [hasViewedRelease, setHasViewedRelease] = useState(false);

  useEffect(() => {
    if (!latestVersion?.releaseDate) {
      setIsRecentRelease(false);
      return;
    }
    const releaseTimestamp = new Date(`${latestVersion.releaseDate}T00:00:00Z`).getTime();
    if (Number.isNaN(releaseTimestamp)) {
      setIsRecentRelease(false);
      return;
    }
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    setIsRecentRelease(now >= releaseTimestamp && now - releaseTimestamp <= twentyFourHoursMs);
  }, [latestVersion.releaseDate]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setHasViewedRelease(false);
      return;
    }
    const storedVersion = window.localStorage.getItem(BETA_BADGE_STORAGE_KEY);
    setHasViewedRelease(storedVersion === latestVersion.version);
  }, [latestVersion.version]);

  const handleBetaBadgeClick = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BETA_BADGE_STORAGE_KEY, latestVersion.version);
    }
    setHasViewedRelease(true);
    onBetaClick?.();
  };

  const shouldGlow = isRecentRelease && !hasViewedRelease;

  return (
    <Sidebar variant={variant} collapsible="offcanvas" {...props}>
      <SidebarHeader className="!pt-2.5 !px-0">
        <SidebarMenu className="px-3">
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton
              onClick={(e) => e.stopPropagation()} // Prevent navigation on button click
              className="data-[slot=sidebar-menu-button]:!p-2 !pt-2.5 !px-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-transparent active:bg-transparent overflow-visible"
            >
              <div className="flex items-center w-full justify-between">
                <Link href="/" className="flex items-center">
                  <Image src="/Logo Type (white).svg" alt="Alphix Logo" width={112} height={24} priority className="dark:block hidden" />
                  <Image src="/Logo Type (black).svg" alt="Alphix Logo" width={112} height={24} priority className="block dark:hidden" />
                </Link>
                <div>
                  {/* Show 'Beta' by default; on hover/glow swap to version text (desktop only) */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={handleBetaBadgeClick}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleBetaBadgeClick(e as unknown as React.MouseEvent<HTMLDivElement>); } }}
                  >
                    <Badge
                      variant="outline"
                      className="bg-button-primary text-sidebar-primary border-sidebar-primary rounded-md font-normal hover-button-primary transition-colors cursor-pointer inline-block"
                      style={{ fontFamily: 'Consolas, monospace' }}
                      title="Click to show update info"
                      onMouseEnter={() => setBadgeHovered(true)}
                      onMouseLeave={() => setBadgeHovered(false)}
                      onFocus={() => setBadgeHovered(true)}
                      onBlur={() => setBadgeHovered(false)}
                    >
                      {/* Mobile: Always show "Beta", Desktop: Show version on hover/glow */}
                      <span className="inline-flex items-center justify-center sm:hidden" style={{ minWidth: 28 }}>
                        Beta
                      </span>
                      <span className="hidden sm:inline-flex items-center justify-center" style={{ minWidth: 28 }}>
                        {shouldGlow ? latestVersion.version : badgeHovered ? latestVersion.version : 'Beta'}
                      </span>
                    </Badge>
                  </div>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Wallet Section - Connect Wallet and Account Status */}
        <div className="px-3 pb-3 mt-2">
          <ConnectWalletButton />
          <AccountStatus />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <div className="mt-auto space-y-2">
          {/* Links section (contains Documentation, Twitter, Discord) */}
          <SidebarGroup>
            <div
              className="flex h-8 shrink-0 items-center rounded-md px-4 text-xs font-normal text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0"
            >
              Links
            </div>
            <SidebarMenu className="mt-1 flex flex-col gap-0 px-2.5">
                <SidebarMenuItem className="list-none">
                  <SidebarMenuButton
                    asChild
                    className="w-full rounded-lg px-1.5 py-1 transition-colors hover:bg-[#1f1f1f] hover:text-white text-muted-foreground"
                  >
                    <a href="https://alphix.gitbook.io/docs/" target="_blank" rel="noopener noreferrer" className="flex items-center">
                      <IconSavedItems className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-1 truncate ml-2 text-xs font-normal">Documentation</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem className="list-none">
                  <SidebarMenuButton
                    asChild
                    className="w-full rounded-lg px-1.5 py-1 transition-colors hover:bg-[#1f1f1f] hover:text-white text-muted-foreground"
                  >
                    <a href="https://x.com/AlphixFi" target="_blank" rel="noopener noreferrer" className="flex items-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                        <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/>
                      </svg>
                      <span className="flex-1 truncate ml-2 text-xs font-normal">Twitter</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem className="list-none">
                  <SidebarMenuButton
                    asChild
                    className="w-full rounded-lg px-1.5 py-1 transition-colors hover:bg-[#1f1f1f] hover:text-white text-muted-foreground"
                  >
                    <a href="https://discord.gg/NTXRarFbTr" target="_blank" rel="noopener noreferrer" className="flex items-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5499-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" fill="currentColor"/>
                      </svg>
                      <span className="flex-1 truncate ml-2 text-xs font-normal">Discord</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* Version info - shown below Discord */}
                <div className="px-1.5 pt-3 sm:hidden">
                  <div
                    className="text-xs text-muted-foreground/50 font-mono select-none cursor-pointer hover:text-muted-foreground/70 transition-colors"
                    onClick={handleBetaBadgeClick}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleBetaBadgeClick(e as unknown as React.MouseEvent<HTMLDivElement>); } }}
                    title="Click to show update info"
                  >
                    v{latestVersion.version} <span className="opacity-60">+{process.env.NEXT_PUBLIC_GIT_COMMIT || 'dev'}</span>
                  </div>
                </div>
              </SidebarMenu>
          </SidebarGroup>
        </div>
      </SidebarContent>
      <SidebarFooter className="p-0">
        {/* AccountStatus moved to header */}
      </SidebarFooter>
    </Sidebar>
  )
}

