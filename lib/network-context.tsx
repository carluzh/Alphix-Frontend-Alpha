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

// Get default network from env var (used for SSR and new users)
function getEnvDefault(): NetworkMode {
  const envDefault = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
  return envDefault === 'mainnet' ? 'mainnet' : 'testnet';
}

export function NetworkProvider({ children, initialNetworkMode }: NetworkProviderProps) {
  const [networkMode, setNetworkModeState] = useState<NetworkMode>(() => {
    // Priority: initialNetworkMode prop > localStorage > env var default
    let mode: NetworkMode;
    if (initialNetworkMode) {
      mode = initialNetworkMode;
    } else if (typeof window === 'undefined') {
      mode = getEnvDefault();
    } else {
      try {
        const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
        mode = (stored === 'mainnet' || stored === 'testnet') ? stored : getEnvDefault();
      } catch {
        mode = getEnvDefault();
      }
    }

    // Set cookie SYNCHRONOUSLY during initialization to prevent race condition
    // Apollo hooks fire immediately after mount, before useEffect runs
    if (typeof window !== 'undefined') {
      document.cookie = `${NETWORK_COOKIE_NAME}=${mode}; path=/; max-age=31536000; SameSite=Lax`;
    }

    return mode;
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
    networkMode,
    setNetworkMode,
    isTestnet: networkMode === 'testnet',
    isMainnet: networkMode === 'mainnet',
    chainId: networkMode === 'testnet' ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID,
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
