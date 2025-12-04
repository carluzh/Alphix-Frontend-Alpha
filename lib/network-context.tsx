"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  type NetworkMode,
  NETWORK_STORAGE_KEY,
  NETWORK_COOKIE_NAME,
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

interface NetworkProviderProps {
  children: React.ReactNode;
  initialNetworkMode?: NetworkMode;
}

export function NetworkProvider({ children, initialNetworkMode }: NetworkProviderProps) {
  const [networkMode, setNetworkModeState] = useState<NetworkMode>(() => {
    if (initialNetworkMode) return initialNetworkMode;
    if (typeof window === 'undefined') return 'testnet';
    try {
      const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
      if (stored === 'mainnet' || stored === 'testnet') return stored;
      return process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
    } catch {
      return 'testnet';
    }
  });

  useEffect(() => {
    document.cookie = `${NETWORK_COOKIE_NAME}=${networkMode}; path=/; max-age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(NETWORK_STORAGE_KEY, networkMode);
    } catch {}
  }, [networkMode]);

  const setNetworkMode = useCallback((mode: NetworkMode) => {
    setNetworkModeState(mode);
    try {
      localStorage.setItem(NETWORK_STORAGE_KEY, mode);
    } catch {
      // localStorage not available
    }
    // Set cookie for server-side access (expires in 1 year)
    document.cookie = `${NETWORK_COOKIE_NAME}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
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
