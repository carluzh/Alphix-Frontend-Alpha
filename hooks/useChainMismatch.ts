"use client";

import { useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useNetwork, MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/network-context';
import { toast } from 'sonner';
import { useSwitchChain } from 'wagmi';

// Module-level singleton to ensure only one toast across all hook instances
let activeToastId: string | number | null = null;

interface ChainMismatchState {
  /** Whether wallet chain differs from expected chain based on network mode */
  isMismatched: boolean;
  /** Wallet's actual connected chainId (may be undefined if not connected) */
  walletChainId: number | undefined;
  /** Expected chainId based on testnet/mainnet mode */
  expectedChainId: number;
  /** Human-readable name of expected chain */
  expectedChainName: string;
  /** Whether user is connected */
  isConnected: boolean;
  /** Function to switch to the expected chain */
  switchToExpectedChain: () => Promise<void>;
}

/** Detects chain mismatch between wallet and expected network mode. Shows toast with switch action. */
export function useChainMismatch(): ChainMismatchState {
  const { chainId: expectedChainId, isTestnet } = useNetwork();
  const { chainId: walletChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const isMismatched = useMemo(() => {
    return isConnected && walletChainId !== undefined && walletChainId !== expectedChainId;
  }, [isConnected, walletChainId, expectedChainId]);

  const expectedChainName = isTestnet ? 'Base Sepolia' : 'Base';

  const switchToExpectedChain = async () => {
    try {
      await switchChainAsync({ chainId: expectedChainId });
      toast.success(`Switched to ${expectedChainName}`);
    } catch (error: any) {
      // User rejected or error occurred
      if (error?.code !== 4001) { // 4001 = user rejected
        console.error('[Chain Switch] Failed:', error?.message);
        toast.error('Failed to switch network', {
          description: `Please switch to ${expectedChainName} manually in your wallet.`,
        });
      }
    }
  };

  // Show/hide sticky toast based on mismatch state
  // Uses module-level singleton to ensure only one toast app-wide
  useEffect(() => {
    if (isMismatched) {
      // Only show if no toast exists globally
      if (activeToastId === null) {
        activeToastId = toast.error(`Wrong Network`, {
          id: 'chain-mismatch', // Fixed ID prevents duplicates
          description: `Please switch to ${expectedChainName}`,
          duration: Infinity,
          action: {
            label: 'Switch',
            onClick: switchToExpectedChain,
          },
        });
      }
    } else {
      // Dismiss toast when mismatch is resolved
      if (activeToastId !== null) {
        toast.dismiss(activeToastId);
        activeToastId = null;
      }
    }
  }, [isMismatched, expectedChainName]);

  return {
    isMismatched,
    walletChainId,
    expectedChainId,
    expectedChainName,
    isConnected,
    switchToExpectedChain,
  };
}

/** Returns the expected chainId based on network mode (not wallet's chain). */
export function useExpectedChainId(): number {
  const { chainId } = useNetwork();
  return chainId;
}
