"use client"

import React, { useState, useEffect, useRef } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { LogOutIcon, MoreVerticalIcon, CopyIcon, CheckIcon, XIcon, HomeIcon } from "lucide-react"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { motion, AnimatePresence } from "framer-motion"
import { DeterministicAvatar } from "@/lib/avatar"

// Account Status component
export function AccountStatus() {
  const { address, isConnected, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { isMobile } = useSidebar() 

  const [displayedName, setDisplayedName] = useState("");
  const [copied, setCopied] = useState(false);
  const [isDisconnectExpanded, setIsDisconnectExpanded] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Set display name when address is available
  useEffect(() => {
    if (address) {
      const storedName = localStorage.getItem(`walletName_${address}`);
      const newDisplayName = storedName || `${address.slice(0, 6)}...${address.slice(-4)}`;
      setDisplayedName(newDisplayName);
    }
  }, [address]);

  // Reset expansion state when connection status changes
  useEffect(() => {
    setIsDisconnectExpanded(false);
  }, [isConnected]);

  const handleCopyName = async () => {
    if (address) {
      try {
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setIsDisconnectExpanded(false);
      }
    };

    if (isDisconnectExpanded) {
      // Add a small delay to prevent immediate triggering
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isDisconnectExpanded]);

  if (!isConnected) {
    return null // Connect button is now handled by ConnectWalletButton component
  }

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''


  // Use wagmi state for render decision
  const shouldShowAccount = isConnected || address;
  
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <motion.div
          ref={accountRef}
          layout
          className="w-full"
        >
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:text-sidebar-accent-foreground data-[state=open]:bg-muted/30 data-[state=open]:hover:bg-muted/30 focus-visible:ring-0 rounded-lg border border-dashed border-sidebar-border/60 hover:bg-muted/30 active:bg-muted/30"
                style={{ opacity: shouldShowAccount ? 1 : 0, pointerEvents: shouldShowAccount ? 'auto' : 'none' }}
                onClick={() => {
                  setIsDisconnectExpanded(!isDisconnectExpanded);
                }}
              >
              {address && (
                <div style={{ width: 30, height: 30, flexShrink: 0 }}>
                  <DeterministicAvatar address={address} size={30} />
                </div>
              )}
              <div className="grid flex-1 text-left text-sm leading-tight">
                {displayedName ? (
                  <>
                    <span className="truncate font-medium">{displayedName}</span>
                    <span className="truncate text-xs text-muted-foreground">Beta Tester</span>
                  </>
                ) : (
                  <>
                    <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-16 bg-muted animate-pulse rounded mt-1" />
                  </>
                )}
              </div>
               {isDisconnectExpanded ? (
                 <Button 
                   variant="ghost" 
                   size="icon" 
                   onClick={(e) => {
                     e.preventDefault();
                     e.stopPropagation();
                     handleCopyName();
                   }}
                   onMouseDown={(e) => {
                     e.preventDefault();
                     e.stopPropagation();
                   }}
                   className="ml-auto h-6 w-6 p-0"
                 >
                   {copied ? (
                     <CheckIcon className="h-4 w-4 text-green-500" />
                   ) : (
                     <CopyIcon className="h-4 w-4 text-muted-foreground" />
                   )}
                 </Button>
               ) : (
                 <MoreVerticalIcon className="ml-auto size-4" />
               )}
            </SidebarMenuButton>
        
         {/* Animated Disconnect Section */}
         <AnimatePresence>
           {isDisconnectExpanded && (
             <motion.div
               initial={{ height: 0, opacity: 0 }}
               animate={{ height: "auto", opacity: 1 }}
               exit={{ height: 0, opacity: 0 }}
               transition={{ type: "spring", stiffness: 300, damping: 30 }}
               className="overflow-hidden"
             >
               <div className="mt-2">
                 <Button
                   onClick={() => disconnect()}
                   className="w-full cursor-pointer justify-start py-1.5 rounded-lg border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:bg-accent hover:brightness-110 hover:border-white/30 text-white/75 transition-all duration-200 overflow-hidden"
                   style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                 >
                   <div className="flex items-center w-full">
                     <LogOutIcon className="h-4 w-4 text-white/75 ml-1" />
                     <span className="mr-3" style={{ marginLeft: '0.75rem' }}>Disconnect</span>
                   </div>
                 </Button>
               </div>
             </motion.div>
           )}
         </AnimatePresence>
        </motion.div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
} 