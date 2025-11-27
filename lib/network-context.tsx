"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  type NetworkMode,
  NETWORK_STORAGE_KEY,
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  getStoredNetworkMode,
  getStoredChainId,
  isTestnetMode,
  isMainnetMode,
} from './network-mode';

// Re-export for convenience (client-side usage)
export {
  type NetworkMode,
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  getStoredNetworkMode,
  getStoredChainId,
  isTestnetMode,
  isMainnetMode,
};

interface NetworkContextValue {
  networkMode: NetworkMode;
  setNetworkMode: (mode: NetworkMode) => void;
  isTestnet: boolean;
  isMainnet: boolean;
  chainId: number;
}

const NetworkContext = createContext<NetworkContextValue | undefined>(undefined);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  // Default to testnet for safety
  const [networkMode, setNetworkModeState] = useState<NetworkMode>('testnet');

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
      if (stored === 'mainnet' || stored === 'testnet') {
        setNetworkModeState(stored);
      }
    } catch {
      // localStorage not available (SSR or error)
    }
  }, []);

  const setNetworkMode = useCallback((mode: NetworkMode) => {
    setNetworkModeState(mode);
    try {
      localStorage.setItem(NETWORK_STORAGE_KEY, mode);
    } catch {
      // localStorage not available
    }
    // Trigger a page reload to reinitialize all clients with new network
    // This ensures wagmi, viem, and all other configs pick up the change
    window.location.reload();
  }, []);

  const value: NetworkContextValue = {
    networkMode,
    setNetworkMode,
    isTestnet: networkMode === 'testnet',
    isMainnet: networkMode === 'mainnet',
    chainId: networkMode === 'testnet' ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID,
  };

  // Always provide context - default to testnet during SSR/initial render
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
