"use client"

import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import { SunIcon, MoonIcon, LaptopIcon, CoinsIcon, Trash2Icon, SettingsIcon, LogOutIcon, CheckIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { baseSepolia } from "@/lib/wagmiConfig"
import { parseAbi } from "viem"
import { useEffect } from "react"

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

// Copied from components/swap-interface.tsx for consistent error icon styling
const WarningToastIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 opacity-80">
    <path fillRule="evenodd" clipRule="evenodd" d="M19.5 12C19.5 16.1421 16.1421 19.5 12 19.5C7.85786 19.5 4.5 16.1421 4.5 12C4.5 7.85786 7.85786 4.5 12 4.5C16.9706 4.5 19.5 7.85786 19.5 12ZM21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12ZM11.25 13.5V8.25H12.75V13.5H11.25ZM11.25 15.75V14.25H12.75V15.75H11.25Z" fill="#e94c4c"/>
  </svg>
);

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
  const { address: userAddress, chainId: currentChainId, isConnected } = useAccount()
  const { writeContract, data:hash, isPending: isTxPending, error: writeTxError, reset: resetWriteContract } = useWriteContract()
  const targetChainId = baseSepolia.id

  const { 
    isLoading: isConfirming, 
    isSuccess: isConfirmed, 
    error: receiptError,
    data: receipt
  } = useWaitForTransactionReceipt({ hash });

  const faucetAbi = parseAbi([
    "function faucet() external",
  ])

  useEffect(() => {
    if (isConfirmed) {
      toast.success(
        <span className="flex items-center">
          <CheckIcon className="mr-2 h-4 w-4 flex-shrink-0" />
          <span>Faucet Success: 100 YUSD and 0.001 BTCRL sent</span>
        </span>
      );
      resetWriteContract();
    }
    const anError = writeTxError || receiptError;
    if (anError) {
      console.log('Faucet Debug - Error Object:', JSON.stringify(anError, Object.getOwnPropertyNames(anError)));
      const shortMsg = (anError as any).shortMessage;
      const mainMsg = anError.message;
      console.log('Faucet Debug - shortMessage:', shortMsg);
      console.log('Faucet Debug - message:', mainMsg);

      let finalErrorMessage = "Faucet Failure: An unexpected error occurred.";

      if (mainMsg?.toLowerCase().includes("user rejected") || shortMsg?.toLowerCase().includes("user rejected")) {
        finalErrorMessage = "Transaction rejected by user.";
      } else if (mainMsg === "unknown reason") {
        // If the transaction reverted with "unknown reason", assume it's the rate limit for this specific faucet.
        finalErrorMessage = "Faucet Failure: Tokens available once per day"; 
      } else if (mainMsg?.toLowerCase().includes("once per day") || shortMsg?.toLowerCase().includes("once per day")) {
        finalErrorMessage = "Faucet Failure: Tokens available once per day";
      } else if (shortMsg) {
        finalErrorMessage = `Faucet Failure: ${shortMsg}`;
      } else if (mainMsg) { // Catch any other message if shortMsg is not available
        finalErrorMessage = `Faucet Failure: ${mainMsg}`;
      }
      
      console.log('Faucet Debug - Determined errorMessage:', finalErrorMessage);

      toast.error(finalErrorMessage, {
        icon: <WarningToastIcon />,
      });
      resetWriteContract();
    }
  }, [isConfirming, isConfirmed, writeTxError, receiptError, receipt, resetWriteContract]);

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
                      <DropdownMenuItem
                        onClick={async () => {
                          if (!isConnected) {
                            toast.error("Please connect your wallet first.")
                            return
                          }

                          if (currentChainId !== targetChainId) {
                            toast.error(`Please switch to the ${baseSepolia.name} network.`)
                            return
                          }

                          if (!userAddress) {
                            toast.error("Could not retrieve wallet address.")
                            return
                          }

                          try {
                            const apiRes = await fetch('/api/misc/faucet', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({ userAddress, chainId: targetChainId }),
                            })
                            const faucetTxData = await apiRes.json()

                            if (!apiRes.ok) {
                              toast.error(`API Error: ${faucetTxData.message || 'Unknown error'}`, {
                                icon: <WarningToastIcon />,
                              });
                              return
                            }
                            
                            console.log("Faucet API response:", faucetTxData)

                            toast.info("Sending faucet transaction to wallet...")

                            writeContract({
                              address: faucetTxData.to as `0x${string}`,
                              abi: faucetAbi,
                              functionName: "faucet",
                              args: [],
                              chainId: faucetTxData.chainId,
                            })
                            
                            // Toasts for pending/success/error are now handled by the useEffect watching useWaitForTransactionReceipt

                          } catch (error: any) {
                            console.error("Faucet action error:", error)
                            toast.error(`Error during faucet action: ${error.message}`, {
                              icon: <WarningToastIcon />,
                            })
                          }
                        }}
                        className="cursor-pointer"
                        disabled={isTxPending || isConfirming}
                      >
                        <CoinsIcon className="mr-2 h-4 w-4" />
                        <span>{isTxPending || isConfirming ? "Processing..." : "Faucet"}</span>
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

