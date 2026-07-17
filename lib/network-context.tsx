"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import {
  type NetworkMode,
  BASE_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  chainIdForMode,
  getChainDisplayName,
  modeForChainId,
} from './network-mode';

export { type NetworkMode };

interface NetworkContextValue {
  // Legacy: still available for components that haven't been migrated yet.
  // Defaults to 'base'. Components should derive chain from data instead.
  networkMode: NetworkMode;
  isBase: boolean;
  isArbitrum: boolean;
  chainId: number;
  chainDisplayName: string;

  // New: wallet-centric properties
  walletChainId: number | undefined;
  /** Auto-switch wallet to the required chain before a transaction. */
  ensureChain: (requiredChainId: number) => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(undefined);

interface NetworkProviderProps {
  children: React.ReactNode;
  initialNetworkMode?: NetworkMode;
}

export function NetworkProvider({ children, initialNetworkMode }: NetworkProviderProps) {
  // Legacy network mode — defaults to 'base', no longer persisted or user-switchable.
  const [networkMode, setNetworkModeState] = useState<NetworkMode>(initialNetworkMode ?? 'base');

  // Wallet state from wagmi
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  // Auto-sync networkMode from wallet chain (so legacy consumers get the right value)
  useEffect(() => {
    if (walletChainId) {
      const mode = modeForChainId(walletChainId);
      if (mode) {
        setNetworkModeState(mode);
      }
    }
  }, [walletChainId]);

  // ensureChain: auto-switch wallet before transaction
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

  const value: NetworkContextValue = {
    networkMode,
    isBase: networkMode === 'base',
    isArbitrum: networkMode === 'arbitrum',
    chainId: chainIdForMode(networkMode),
    chainDisplayName: getChainDisplayName(networkMode),
    walletChainId,
    ensureChain,
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
