"use client"

import { useState, useRef, useEffect } from "react"
import { PlusCircleIcon, /* LockIcon, */ type LucideIcon, CoinsIcon, Trash2Icon } from "lucide-react"
import { CustomLockIcon } from "./CustomLockIcon"
import { usePathname } from "next/navigation";
import { toast } from "sonner"
import { useAccount, useSignTypedData, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi"
import { config, baseSepolia } from "../lib/wagmiConfig";
import { getAddress, parseUnits, type Address, type Hex } from "viem"
import { publicClient } from "../lib/viemClient";
import { FAUCET_CONTRACT_ADDRESS, FAUCET_FUNCTION_SIGNATURE, faucetContractAbi } from "../pages/api/misc/faucet"; // Import constants
import { useRouter } from "next/navigation"; // Import useRouter
import { WarningToastIcon, SuccessToastIcon } from "./swap/swap-interface"; // Adjusted import for toasts
import { parseAbi } from "viem"
import { Badge } from "./ui/badge"; // Added import for Badge
import { cn } from "@/lib/utils"; // Added import for cn

import {
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
    if (seconds === null || seconds <= 0) return "Claim"; // Changed from "Ready" to "Claim"

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    // Always show minutes, with leading zero if single digit
    parts.push(`${minutes.toString().padStart(2, '0')}m`);
    
    return parts.join(" "); // No "left" suffix
  };

  // Effect to load cached lastCalled timestamp on sidebar mount
  useEffect(() => {
    if (!userAddress) return;
    const cached = localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`);
    if (cached) {
      setCachedLastCalled(parseInt(cached, 10));
    }
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
        setFaucetCooldown(formatTimeLeft(timeLeft)); // Use formatTimeLeft to get "Claim"
        return;
      }
      setFaucetCooldown(formatTimeLeft(timeLeft));
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
      toast.success("Faucet Success: Tokens sent");
      resetWriteContract();
      // On successful claim, update local cache and refetch from contract
      const now = Math.floor(Date.now() / 1000);
      if (userAddress) {
        localStorage.setItem(`faucetLastClaimTimestamp_${userAddress}`, now.toString());
        setCachedLastCalled(now); // Update state to trigger recalculation
      }
      refetchLastCalled(); // Immediately refetch from contract for accuracy
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

      toast.error(finalErrorMessage, {
        icon: <WarningToastIcon />,
      });
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
        toast.error(toastMessage, {
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
    } catch (error: any) {
      console.error("Faucet action error:", error)
      toast.error(`Error during faucet action: ${error.message}`, {
        icon: <WarningToastIcon />,
      })
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
                className="w-full flex items-center"
                tooltip={item.title}
                disabled={isTxPending || isConfirming}
              >
                {item.icon && <item.icon />}
                <span className="flex-1 truncate">
                  {isTxPending || isConfirming ? "Processing..." : item.title}
                </span>
                {faucetCooldown && item.isFaucet && (
                  <Badge
                    variant="outline" /* Keep outline variant for base structural styles and border handling */
                    className={cn(
                      "ml-2 inline-flex items-center px-2 py-1 text-xs font-mono leading-none font-normal rounded-md", // Manual padding, restored structural classes, font, and shape
                      faucetCooldown === "Claim" ?
                        "bg-[#3d271b] text-sidebar-primary border-sidebar-primary hover:bg-[#4a2f1f] transition-colors cursor-default"
                        :
                        "bg-sidebar-accent text-white border-transparent opacity-70"
                    )}
                    style={faucetCooldown === "Claim" ? { fontFamily: 'Consolas, monospace' } : undefined}
                  >
                    {faucetCooldown}
                  </Badge>
                )}
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

