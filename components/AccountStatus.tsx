"use client"

import React, { useState, useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOutIcon, MoreVerticalIcon, Edit3Icon, CheckIcon, XIcon, HomeIcon, SettingsIcon } from "lucide-react"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { LevelProgress } from "@/components/LevelProgress"
import { Input } from "@/components/ui/input"

// Account Status component
export function AccountStatus() {
  const { address, isConnected, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { isMobile } = useSidebar() 

  const [displayedName, setDisplayedName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [inputName, setInputName] = useState("");

  // Set display name when address is available
  useEffect(() => {
    if (address) {
      const storedName = localStorage.getItem(`walletName_${address}`);
      const newDisplayName = storedName || `${address.slice(0, 6)}...${address.slice(-4)}`;
      setDisplayedName(newDisplayName);
      setInputName(newDisplayName);
    }
  }, [address]);

  // Cache the display name whenever it changes
  useEffect(() => {
    if (displayedName) {
      localStorage.setItem('cachedDisplayName', displayedName);
    }
  }, [displayedName]);

  const handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputName(e.target.value);
  };

  const handleSaveName = () => {
    if (address && inputName.trim() !== "") {
      localStorage.setItem(`walletName_${address}`, inputName.trim());
      setDisplayedName(inputName.trim());
      setIsEditingName(false);
    } else if (address) {
      if (localStorage.getItem(`walletName_${address}`)) {
          localStorage.removeItem(`walletName_${address}`);
      }
      const fallbackName = shortAddress; // Changed fallback to wallet address
      setDisplayedName(fallbackName);
      setInputName(fallbackName);
      setIsEditingName(false);
    }
  };

  const handleEditClick = () => {
    setInputName(displayedName);
    setIsEditingName(true);
  }

  const handleCancelEdit = () => {
    setInputName(displayedName);
    setIsEditingName(false);
  }

  if (!isConnected) {
    return (
      <SidebarMenu>
        <SidebarMenuItem className="list-none"> 
          <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
            <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
            <span className="relative z-0 pointer-events-none">Connect Wallet</span>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      )
  }

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''

  // Mock data for leveling system
  const levelData = {
    currentLevel: 0,
    currentXP: 0,
    nextLevelXP: 1000
  }

  // Use wagmi state for render decision
  const shouldShowAccount = isConnected || address;
  
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground focus-visible:ring-0"
              style={{ opacity: shouldShowAccount ? 1 : 0, pointerEvents: shouldShowAccount ? 'auto' : 'none' }}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{displayedName.charAt(0).toUpperCase() || "C"}</AvatarFallback>
              </Avatar>
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
              <MoreVerticalIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg border-sidebar-accent"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={16}
            style={{ backgroundColor: '#09090b' }}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm group">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{displayedName.charAt(0).toUpperCase() || "C"}</AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col text-left text-sm leading-tight min-w-0">
                  {isEditingName ? (
                    <div className="flex items-center gap-1">
                      <Input 
                        type="text" 
                        value={inputName} 
                        onChange={handleNameInputChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        onBlur={handleSaveName}
                        className="h-6 px-1.5 py-1 text-sm rounded-md focus-visible:ring-0 focus-visible:ring-offset-0 border-0 shadow-none bg-transparent focus:outline-none"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="truncate font-medium pr-6">{displayedName}</div>
                      {address && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={handleEditClick} 
                          className="absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Edit3Icon className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  )}
                  <span className="truncate text-xs text-muted-foreground">Beta Tester</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <div className="relative px-2 pt-0.5 pb-1.5 flex items-center cursor-pointer group">
              <LevelProgress {...levelData} className="flex-grow" />
              <span className="ml-2 text-xs font-medium text-muted-foreground whitespace-nowrap">
                Lvl {levelData.currentLevel}
              </span>
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/60 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  Coming Soon
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => disconnect()} className="cursor-pointer">
              <LogOutIcon className="mr-2 h-4 w-4 text-muted-foreground" /> 
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
} 