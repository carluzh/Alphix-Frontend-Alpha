"use client";

import { useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { getChainDisplayName, modeForChainId } from '@/lib/network-mode';

interface ChainMismatchState {
  walletChainId: number | undefined;
  isConnected: boolean;
  ensureChain: (requiredChainId: number) => Promise<boolean>;
}

export function useChainMismatch(): ChainMismatchState {
  const { chainId: walletChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const ensureChain = useCallback(async (requiredChainId: number): Promise<boolean> => {
    if (walletChainId === requiredChainId) return true;

    const mode = modeForChainId(requiredChainId);
    const chainName = mode ? getChainDisplayName(mode) : `Chain ${requiredChainId}`;

    try {
      await switchChainAsync({ chainId: requiredChainId });
      toast.success(`Switched to ${chainName}`);
      return true;
    } catch (error: any) {
      if (error?.code !== 4001) {
        toast.error('Failed to switch network', {
          description: `Please switch to ${chainName} manually in your wallet.`,
        });
      }
      return false;
    }
  }, [walletChainId, switchChainAsync]);

  return {
    walletChainId,
    isConnected,
    ensureChain,
  };
}
