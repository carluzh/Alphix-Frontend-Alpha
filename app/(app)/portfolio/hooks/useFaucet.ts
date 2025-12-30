"use client";

import { useState, useEffect } from "react";
import { parseAbi } from "viem";
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { baseSepolia } from "@/lib/wagmiConfig";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { FAUCET_CONTRACT_ADDRESS, faucetContractAbi } from "@/pages/api/misc/faucet";
import React from "react";

interface UseFaucetConfig {
  userAddress?: `0x${string}`;
  userIsConnected: boolean;
  currentChainId?: number;
}

export function useFaucet({ userAddress, userIsConnected, currentChainId }: UseFaucetConfig) {
  const { writeContract } = useWriteContract();
  const faucetAbi = parseAbi(['function faucet() external']);
  const [faucetHash, setFaucetHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isFaucetConfirming, isSuccess: isFaucetConfirmed } = useWaitForTransactionReceipt({ hash: faucetHash });
  const [faucetLastClaimTs, setFaucetLastClaimTs] = useState<number>(-1);
  const [isFaucetBusy, setIsFaucetBusy] = useState<boolean>(false);

  const { data: faucetLastCalledOnchain, refetch: refetchFaucetOnchain } = useReadContract({
    address: FAUCET_CONTRACT_ADDRESS,
    abi: faucetContractAbi,
    functionName: 'lastCalled',
    args: [userAddress!],
    chainId: baseSepolia.id,
    query: {
      enabled: userIsConnected && currentChainId === baseSepolia.id && !!userAddress,
    },
  });

  // When confirmed, mirror sidebar behavior: update local cache and button state immediately
  useEffect(() => {
    if (!isFaucetConfirmed || !userAddress) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(`faucetLastClaimTimestamp_${userAddress}`, String(now));
      localStorage.setItem(`faucetClaimLastSeenAt_${userAddress}`, String(now));
      setFaucetLastClaimTs(now);
      setIsFaucetBusy(false);
      toast.success('Faucet Claimed', {
        icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-sidebar-primary" }),
        className: 'faucet-claimed'
      });
      setTimeout(() => {
        try {
          localStorage.setItem(`walletBalancesRefreshAt_${userAddress}`, String(Date.now()));
          window.dispatchEvent(new Event('walletBalancesRefresh'));
        } catch {}
      }, 2000);
    } catch {}
  }, [isFaucetConfirmed, userAddress]);

  // Sync cached faucet last-claim timestamp
  useEffect(() => {
    if (!userAddress) {
      setFaucetLastClaimTs(-1);
      return;
    }
    if (faucetLastCalledOnchain !== undefined && faucetLastCalledOnchain !== null) {
      const n = Number(faucetLastCalledOnchain);
      if (Number.isFinite(n) && n > 0) {
        setFaucetLastClaimTs(n);
      }
    }
    try {
      const cached = localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`);
      setFaucetLastClaimTs(cached ? Number(cached) : 0);
    } catch {
      setFaucetLastClaimTs(0);
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === `faucetLastClaimTimestamp_${userAddress}`) {
        const next = Number(localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`) || '0');
        setFaucetLastClaimTs(Number.isFinite(next) ? next : 0);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userAddress, faucetLastCalledOnchain]);

  return {
    writeContract,
    faucetAbi,
    faucetHash,
    setFaucetHash,
    isFaucetConfirming,
    isFaucetConfirmed,
    faucetLastClaimTs,
    isFaucetBusy,
    setIsFaucetBusy,
    faucetLastCalledOnchain,
    refetchFaucetOnchain,
  };
}
