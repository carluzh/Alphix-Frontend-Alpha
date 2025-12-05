// Network mode utilities - SSR-safe (no "use client" directive)
// This file can be imported by both client and server code

export type NetworkMode = 'mainnet' | 'testnet';

export const NETWORK_STORAGE_KEY = 'alphix-network-mode';
export const NETWORK_COOKIE_NAME = 'alphix-network-mode';

// Chain IDs
export const MAINNET_CHAIN_ID = 8453;  // Base Mainnet
export const TESTNET_CHAIN_ID = 84532; // Base Sepolia

/**
 * Parse network mode from a cookie string (for server-side usage)
 */
export function getNetworkModeFromCookies(cookieString: string | undefined | null): NetworkMode | null {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp(`(?:^|;\\s*)${NETWORK_COOKIE_NAME}=([^;]*)`));
  if (match && (match[1] === 'mainnet' || match[1] === 'testnet')) {
    return match[1] as NetworkMode;
  }
  return null;
}

export function getStoredNetworkMode(): NetworkMode {
  if (typeof window === 'undefined') return 'mainnet';

  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (stored === 'mainnet' || stored === 'testnet') return stored;
    return 'mainnet';
  } catch {
    return 'mainnet';
  }
}

export function getStoredChainId(): number {
  return getStoredNetworkMode() === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;
}

export function isTestnetMode(): boolean {
  return getStoredNetworkMode() === 'testnet';
}

export function isMainnetMode(): boolean {
  return getStoredNetworkMode() === 'mainnet';
}
