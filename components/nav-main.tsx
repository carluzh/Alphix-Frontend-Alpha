"use client"

import { useState, useRef, useEffect } from "react"
import { PlusCircleIcon, /* LockIcon, */ type LucideIcon, CoinsIcon, Trash2Icon, OctagonX } from "lucide-react"
import { CustomLockIcon } from "./CustomLockIcon"
import { usePathname } from "next/navigation";
import { toast } from "sonner"
import { useAccount, useSignTypedData, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi"
import { config, baseSepolia } from "../lib/wagmiConfig";
import { getAddress, parseUnits, type Address, type Hex } from "viem"
import { publicClient } from "../lib/viemClient";
import { FAUCET_CONTRACT_ADDRESS, FAUCET_FUNCTION_SIGNATURE, faucetContractAbi } from "../pages/api/misc/faucet"; // Import constants
import { useRouter } from "next/navigation"; // Import useRouter
// Removed unused SuccessToastIcon import to satisfy linter
import { BadgeCheck } from "lucide-react";
import { parseAbi } from "viem"
import { cn } from "@/lib/utils"; // Added import for cn

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
} from "@/components/ui/sidebar"

const OutOfRangeToastIcon = () => (<OctagonX className="h-4 w-4 text-red-500" />);

interface NavMainItem {
  title: string
  url?: string
  icon?: LucideIcon
  disabled?: boolean
  isFaucet?: boolean
}

export function NavMain({
  items,
}: {
  items: NavMainItem[]
}) {
  const [lockedItem, setLockedItem] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pathname = usePathname();
  
  // Faucet-related state and hooks
  const { address: userAddress, chainId: currentChainId, isConnected } = useAccount()
  const { writeContract, data:hash, isPending: isTxPending, error: writeTxError, reset: resetWriteContract } = useWriteContract()
  const targetChainId = baseSepolia.id

  // State for faucet cooldown and caching
  const [faucetCooldown, setFaucetCooldown] = useState<string | null>(null);
  const [cachedLastCalled, setCachedLastCalled] = useState<number | null>(null);
  const [faucetAvailableAt, setFaucetAvailableAt] = useState<number | null>(null);
  const [isFaucetUnread, setIsFaucetUnread] = useState<boolean>(false);
  const [faucetStep, setFaucetStep] = useState<number>(10); // 1..10
  const PROGRESS_RADIUS = 8;
  const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_RADIUS;

  // Read the lastCalled timestamp from the contract
  const { data: contractLastCalled, isLoading: isLoadingLastCalled, refetch: refetchLastCalled } = useReadContract({
    address: FAUCET_CONTRACT_ADDRESS,
    abi: faucetContractAbi,
    functionName: 'lastCalled',
    args: [userAddress!],
    chainId: targetChainId,
    query: {
      enabled: isConnected && currentChainId === targetChainId && !!userAddress,
      // Removed refetchInterval and refetchOnWindowFocus for elegance
    },
  });

  // Helper function to format time left
  const formatTimeLeft = (seconds: number | null): string => {
    if (seconds === null || (typeof seconds === 'number' && seconds <= 0)) return "Claim"; // Changed from "Ready" to "Claim"

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    // Always show minutes, with leading zero if single digit
    parts.push(`${String(minutes).padStart(2, '0')}m`);
    
    return parts.join(" "); // No "left" suffix
  };

  // Effect to load cached lastCalled timestamp on sidebar mount
  useEffect(() => {
    if (!userAddress) return;
    const cached = localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`);
    if (cached) {
      setCachedLastCalled(parseInt(cached, 10));
    }

    // Listen to cross-tab storage changes
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !userAddress) return;
      if (e.key === `faucetClaimLastSeenAt_${userAddress}`) {
        const seenAt = Number(localStorage.getItem(`faucetClaimLastSeenAt_${userAddress}`) || "0");
        setIsFaucetUnread(Boolean(faucetAvailableAt && seenAt < faucetAvailableAt));
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [userAddress]);

  // Effect to calculate and update cooldown time
  useEffect(() => {
    // Prioritize contract data if available and not loading, otherwise use cached
    const effectiveLastCalled = contractLastCalled !== undefined && !isLoadingLastCalled 
                                ? Number(contractLastCalled) // Convert BigInt to Number for Date object
                                : cachedLastCalled;

    if (effectiveLastCalled === null || !isConnected || currentChainId !== targetChainId) {
      setFaucetCooldown(null); // Not connected, wrong network, or no data
      return;
    }

    const calculateCooldown = () => {
      const oneDayInSeconds = 24 * 60 * 60;
      const nextClaimTimestamp = effectiveLastCalled + oneDayInSeconds;
      const currentTime = Math.floor(Date.now() / 1000);
      const timeLeft = nextClaimTimestamp - currentTime;

      if (timeLeft <= 0) {
        // Transitioned to Claim state
        setFaucetCooldown(formatTimeLeft(timeLeft));
        setFaucetStep(10);
        if (!faucetAvailableAt) {
          const now = Math.floor(Date.now() / 1000);
          setFaucetAvailableAt(now);
          const seenAt = Number(localStorage.getItem(`faucetClaimLastSeenAt_${userAddress}`) || "0");
          setIsFaucetUnread(seenAt < now);
        }
        return;
      }
      setFaucetCooldown(formatTimeLeft(timeLeft));
      const elapsed = oneDayInSeconds - timeLeft;
      // 10 discrete steps, start at 1 immediately; never show 10 (100%) until claimable
      const raw = Math.floor((elapsed / oneDayInSeconds) * 10);
      const step = Math.max(1, Math.min(9, raw));
      setFaucetStep(step);
      // Reset availability and unread when not claimable
      if (faucetAvailableAt !== null) {
        setFaucetAvailableAt(null);
        setIsFaucetUnread(false);
      }
    };

    calculateCooldown(); // Initial calculation

    // Update every minute (or more frequently for the last minute if needed)
    const interval = setInterval(() => {
      calculateCooldown();
    }, 1000 * 60); // Every minute

    return () => clearInterval(interval);

  }, [contractLastCalled, cachedLastCalled, isConnected, currentChainId, targetChainId, isLoadingLastCalled]);

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
      toast.success("Faucet Claimed", { icon: <BadgeCheck className="h-4 w-4 text-sidebar-primary" /> });
      resetWriteContract();
      // On successful claim, update local cache and refetch from contract
      const now = Math.floor(Date.now() / 1000);
      if (userAddress) {
        localStorage.setItem(`faucetLastClaimTimestamp_${userAddress}`, now.toString());
        setCachedLastCalled(now); // Update state to trigger recalculation
      }
      refetchLastCalled(); // Immediately refetch from contract for accuracy
      // Force wallet balances refetch across the app (and tabs) after a delay
      // to ensure blockchain state has settled
      setTimeout(() => {
        try {
          if (userAddress) {
            localStorage.setItem(`walletBalancesRefreshAt_${userAddress}`, String(Date.now()));
          }
          window.dispatchEvent(new Event('walletBalancesRefresh'));
        } catch {}
      }, 2000); // 2 second delay
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
        finalErrorMessage = "Faucet Failure: Tokens available once per day"; 
      } else if (mainMsg?.toLowerCase().includes("once per day") || shortMsg?.toLowerCase().includes("once per day")) {
        finalErrorMessage = "Faucet Failure: Tokens available once per day";
      } else if (shortMsg) {
        finalErrorMessage = `Faucet Failure: ${shortMsg}`;
      } else if (mainMsg) { 
        finalErrorMessage = `Faucet Failure: ${mainMsg}`;
      }
      
      console.log('Faucet Debug - Determined errorMessage:', finalErrorMessage);

      const lower2 = String(finalErrorMessage).toLowerCase();
      if (lower2.includes('once per day')) {
        toast.error('Can only claim once per day', { icon: <OutOfRangeToastIcon /> });
      } else {
        toast.error(finalErrorMessage, { icon: <OutOfRangeToastIcon /> });
      }
      resetWriteContract();
    }
  }, [isConfirming, isConfirmed, writeTxError, receiptError, receipt, resetWriteContract]);

  const handleLockedClick = (itemName: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setLockedItem(itemName)
    timeoutRef.current = setTimeout(() => {
      setLockedItem(null)
    }, 1000)
  }

  const handleFaucetClick = async () => {
    // Mark faucet notification as seen if it's currently claimable
    if (faucetCooldown === "Claim" && userAddress) {
      try {
        const now = Math.floor(Date.now() / 1000);
        localStorage.setItem(`faucetClaimLastSeenAt_${userAddress}`, String(now));
        setIsFaucetUnread(false);
      } catch {}
    }
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
      const toastMessage = faucetTxData.errorDetails || `API Error: ${faucetTxData.message || 'Unknown error'}`;
      const lower = String(toastMessage).toLowerCase();
      if (lower.includes('once per day')) {
        toast.error('Can only claim once per day', { icon: <OutOfRangeToastIcon /> });
      } else {
        toast.error(toastMessage, { icon: <OutOfRangeToastIcon /> });
      }
        return
      }
      console.log("Faucet API response:", faucetTxData)
      // removed info toast per request
      writeContract({
        address: faucetTxData.to as `0x${string}`,
        abi: faucetAbi,
        functionName: "faucet",
        args: [],
        chainId: faucetTxData.chainId,
      })
    } catch (error: any) {
      console.error("Faucet action error:", error)
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('once per day')) {
        toast.error('Can only claim once per day', { icon: <OutOfRangeToastIcon /> });
      } else {
        toast.error(`Error during faucet action: ${error.message}`, { icon: <OctagonX className="h-4 w-4 text-red-500" /> })
      }
    }
  }

  return (
    <SidebarMenu className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const isActive = item.url === pathname;

        return (
          <SidebarMenuItem key={item.title} className="list-none">
            {item.disabled ? (
              <SidebarMenuButton
                onClick={() => handleLockedClick(item.title)}
                className="opacity-75 w-full flex items-center"
                tooltip={item.title}
              >
                {item.icon && <item.icon />}
                <span className="flex-1 truncate">{item.title}</span>
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
                className="group/faucet w-full flex items-center"
                tooltip={item.title}
                disabled={isTxPending || isConfirming}
              >
                {item.icon && <item.icon />}
                <span className="flex-1 truncate">
                  {isTxPending || isConfirming ? "Processing..." : item.title}
                </span>
                {item.isFaucet && faucetCooldown && (
                  faucetCooldown === "Claim" ? (
                    isFaucetUnread && (
                      <SidebarMenuBadge className="bg-[#3d271b] text-sidebar-primary border border-sidebar-primary">1</SidebarMenuBadge>
                    )
                  ) : (
                    <>
                      {/* Align ring to the same slot as SidebarMenuBadge so it lines up with Portfolio */}
                      <SidebarMenuBadge className="p-0 px-0 bg-transparent border-0 group-hover/faucet:hidden">
                        <svg
                          className="h-5 w-5"
                          viewBox="0 0 24 24"
                          aria-label="Faucet cooldown"
                        >
                          {/* Track (100%) */}
                          <circle
                            cx="12"
                            cy="12"
                            r="8"
                            fill="none"
                            className="sidebar-ring-track"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                          {/* Progress (rounded ends) */}
                          <circle
                            cx="12"
                            cy="12"
                            r="8"
                            fill="none"
                            className="sidebar-ring-progress"
                            stroke="currentColor"
                            strokeOpacity="0.85"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={`${PROGRESS_CIRC}`}
                            strokeDashoffset={`${PROGRESS_CIRC * (1 - (faucetStep * 0.1))}`}
                            transform="rotate(-90 12 12)"
                          />
                        </svg>
                      </SidebarMenuBadge>

                      {/* Hover state: show old time badge fully, aligned to the same position */}
                      <SidebarMenuBadge
                        className={cn(
                          "hidden group-hover/faucet:inline-flex px-2 py-1 text-xs font-mono leading-none font-normal rounded-md",
                          "bg-sidebar-accent text-white border-transparent opacity-70"
                        )}
                      >
                        {faucetCooldown}
                      </SidebarMenuBadge>
                    </>
                  )
                )}
              </SidebarMenuButton>
            ) : item.title === "Portfolio" ? (
              <SidebarMenuButton tooltip={item.title} asChild className="w-full" isActive={isActive}>
                <a href={item.url!} className="flex items-center w-full">
                  {item.icon && <item.icon />}
                  <span className="flex-1 truncate">{item.title}</span>
                </a>
              </SidebarMenuButton>
            ) : item.title === "Swap" ? (
              <SidebarMenuButton
                tooltip="Swap"
                className="w-full"
                asChild
                isActive={isActive}
              >
                <a href={item.url!} className="flex items-center w-full">
                  {item.icon ? <item.icon /> : <PlusCircleIcon />}
                  <span className="flex-1 truncate">Swap</span>
                </a>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton tooltip={item.title} asChild className="w-full" isActive={isActive}>
                <a href={item.url!} className="flex items-center w-full">
                  {item.icon && <item.icon />}
                  <span className="flex-1 truncate">{item.title}</span>
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  )
}

