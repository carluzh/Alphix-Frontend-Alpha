"use client"

import { useState, useRef, useEffect, useCallback, useTransition } from "react"
import { type LucideIcon } from "lucide-react"
import { IconPlus } from "nucleo-micro-bold-essential"
import { CustomLockIcon } from "./CustomLockIcon"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { FaucetClaimModal } from "@/components/faucet"
import { useNavigationProgress } from "@/lib/navigation-progress"

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export interface NavMainItem {
  title: string
  url?: string
  icon?: LucideIcon | React.ComponentType<any>
  disabled?: boolean
  isFaucet?: boolean
}

export function NavMain({
  items,
}: {
  items: NavMainItem[]
}) {
  const [lockedItem, setLockedItem] = useState<string | null>(null)
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { setOpenMobile, isMobile } = useSidebar()
  const { startNavigation } = useNavigationProgress()

  useEffect(() => {
    if (optimisticPath && pathname === optimisticPath) {
      setOptimisticPath(null)
    }
  }, [pathname, optimisticPath])

  useEffect(() => {
    items.forEach((item) => {
      if (item.url && !item.disabled) router.prefetch(item.url)
    })
  }, [items, router])

  const handleNavClick = useCallback((e: React.MouseEvent, url: string) => {
    e.preventDefault()
    // Close mobile sidebar before navigating
    if (isMobile) {
      setOpenMobile(false)
    }
    setOptimisticPath(url)
    startNavigation(url)
    startTransition(() => {
      router.push(url)
    })
  }, [router, startTransition, isMobile, setOpenMobile, startNavigation])

  // Faucet modal state
  const [isFaucetModalOpen, setIsFaucetModalOpen] = useState(false)

  const handleLockedClick = (itemName: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setLockedItem(itemName)
    timeoutRef.current = setTimeout(() => {
      setLockedItem(null)
    }, 1000)
  }

  const handleFaucetClick = useCallback(() => {
    // Close mobile sidebar before opening modal
    if (isMobile) {
      setOpenMobile(false)
    }
    setIsFaucetModalOpen(true)
  }, [isMobile, setOpenMobile])

  return (
    <>
    <SidebarMenu className="flex flex-col gap-0.5 px-2">
      {items.map((item) => {
        const isActive = (() => {
          if (!item.url) return false
          const activePath = optimisticPath || pathname || ""
          return activePath === item.url || activePath.startsWith(`${item.url}/`)
        })();

        return (
          <SidebarMenuItem key={item.title} className="list-none">
            {item.disabled ? (
              <SidebarMenuButton
                onClick={() => handleLockedClick(item.title)}
                className={cn(
                  "w-full flex items-center rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                  "text-muted-foreground"
                )}
                tooltip={item.title}
              >
                {item.icon && <item.icon className="h-4 w-4 flex-shrink-0" />}
                <span className="flex-1 truncate ml-2 text-sm font-medium">{item.title}</span>
                {lockedItem === item.title && (
                  <span className="flex items-center">
                    <CustomLockIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground mr-0.5" />
                    <span className="text-[10px] text-muted-foreground">Soon</span>
                  </span>
                )}
              </SidebarMenuButton>
            ) : item.isFaucet ? (
              <SidebarMenuButton
                onClick={handleFaucetClick}
                className={cn(
                  "w-full flex items-center rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                  "text-muted-foreground"
                )}
                tooltip={item.title}
              >
                {item.icon && <item.icon className="h-4 w-4 flex-shrink-0" />}
                <span className="flex-1 truncate ml-2.5 text-sm font-medium">
                  {item.title}
                </span>
              </SidebarMenuButton>
            ) : item.title === "Portfolio" ? (
              <SidebarMenuButton
                tooltip={item.title}
                asChild
                className={cn(
                  "w-full rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                  isActive
                    ? "bg-[#1f1f1f] text-white"
                    : "text-muted-foreground"
                )}
              >
                <a href={item.url!} onClick={(e) => handleNavClick(e, item.url!)} className="flex items-center w-full">
                  {item.icon && <item.icon className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive ? "text-white" : ""
                  )} />}
                  <span className="flex-1 truncate ml-2 text-sm font-medium">{item.title}</span>
                </a>
              </SidebarMenuButton>
            ) : item.title === "Swap" ? (
              <SidebarMenuButton
                tooltip="Swap"
                asChild
                className={cn(
                  "w-full rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                  isActive
                    ? "bg-[#1f1f1f] text-white"
                    : "text-muted-foreground"
                )}
              >
                <a href={item.url!} onClick={(e) => handleNavClick(e, item.url!)} className="flex items-center w-full">
                  {item.icon ? (
                    <item.icon className={cn(
                      "h-4 w-4 flex-shrink-0",
                      isActive ? "text-white" : ""
                    )} />
                  ) : (
                    <IconPlus className={cn(
                      "h-4 w-4 flex-shrink-0",
                      isActive ? "text-white" : ""
                    )} />
                  )}
                  <span className="flex-1 truncate ml-2 text-sm font-medium">Swap</span>
                </a>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                tooltip={item.title}
                asChild
                className={cn(
                  "w-full rounded-lg px-2 py-2 transition-colors hover:bg-[#1f1f1f] hover:text-white",
                  isActive
                    ? "bg-[#1f1f1f] text-white"
                    : "text-muted-foreground"
                )}
              >
                <a href={item.url!} onClick={(e) => handleNavClick(e, item.url!)} className="flex items-center w-full">
                  {item.icon && <item.icon className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive ? "text-white" : ""
                  )} />}
                  <span className="flex-1 truncate ml-2 text-sm font-medium">{item.title}</span>
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>

    {/* Faucet Claim Modal */}
    <FaucetClaimModal
      isOpen={isFaucetModalOpen}
      onClose={() => setIsFaucetModalOpen(false)}
    />
    </>
  )
}

