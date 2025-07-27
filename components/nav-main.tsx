"use client"

import { useState, useRef, useEffect } from "react"
import { PlusCircleIcon, /* LockIcon, */ type LucideIcon, CoinsIcon, Trash2Icon } from "lucide-react"
import { CustomLockIcon } from "./CustomLockIcon"
import { usePathname } from "next/navigation";
import { toast } from "sonner"
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { baseSepolia } from "@/lib/wagmiConfig"
import { parseAbi } from "viem"

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

