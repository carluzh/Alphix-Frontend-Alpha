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

// OVERRIDE: Always use mainnet (testnet removed)
function getEnvDefault(): NetworkMode {
  return 'mainnet';
}

export function NetworkProvider({ children, initialNetworkMode }: NetworkProviderProps) {
  const [networkMode, setNetworkModeState] = useState<NetworkMode>(() => {
    // OVERRIDE: Always mainnet (testnet removed)
    // Clear any stale testnet values from localStorage
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
        if (stored === 'testnet') {
          localStorage.setItem(NETWORK_STORAGE_KEY, 'mainnet');
        }
      } catch {}
      // Always set mainnet cookie
      document.cookie = `${NETWORK_COOKIE_NAME}=mainnet; path=/; max-age=31536000; SameSite=Lax`;
    }
    return 'mainnet';
  });

  // Still keep useEffect for localStorage sync and future mode changes
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
    } catch {}
    document.cookie = `${NETWORK_COOKIE_NAME}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
    window.location.reload();
  }, []);

  const value: NetworkContextValue = {
    networkMode: 'mainnet', // OVERRIDE: Always mainnet
    setNetworkMode,
    isTestnet: false, // OVERRIDE: Always false
    isMainnet: true, // OVERRIDE: Always true
    chainId: MAINNET_CHAIN_ID, // OVERRIDE: Always mainnet chain
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
