// Network mode utilities - SSR-safe (no "use client" directive)
// This file can be imported by both client and server code

export type NetworkMode = 'mainnet' | 'testnet';

export const NETWORK_STORAGE_KEY = 'alphix-network-mode';

// Chain IDs
export const MAINNET_CHAIN_ID = 8453;  // Base Mainnet
export const TESTNET_CHAIN_ID = 84532; // Base Sepolia

/**
 * Get current network mode without React context (for non-component code)
 * IMPORTANT: This function is safe to call from both client and server
 *
 * Server-side: Always defaults to testnet (unless NEXT_PUBLIC_DEFAULT_NETWORK is set)
 * Client-side: Reads from localStorage
 */
export function getStoredNetworkMode(): NetworkMode {
  // Server-side: always default to testnet for safety
  if (typeof window === 'undefined') {
    // Check if we have an environment variable for server-side network
    const envNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
    if (envNetwork === 'mainnet') return 'mainnet';
    return 'testnet'; // Default for SSR
  }

  // Client-side: check localStorage
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    return stored === 'mainnet' ? 'mainnet' : 'testnet';
  } catch {
    return 'testnet';
  }
}

/**
 * Get chain ID based on current network mode
 */
export function getStoredChainId(): number {
  return getStoredNetworkMode() === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;
}

/**
 * Check if currently in testnet mode
 */
export function isTestnetMode(): boolean {
  return getStoredNetworkMode() === 'testnet';
}

/**
 * Check if currently in mainnet mode
 */
export function isMainnetMode(): boolean {
  return getStoredNetworkMode() === 'mainnet';
}
