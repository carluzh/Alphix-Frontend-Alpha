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

/**
 * Get current network mode without React context (for non-component code)
 * IMPORTANT: This function is safe to call from both client and server
 *
 * Server-side: Checks env variable, defaults to testnet
 * Client-side: Reads from localStorage
 *
 * For server-side API routes that need cookie-based network mode,
 * use getNetworkModeFromCookies() with the request cookie header.
 */
export function getStoredNetworkMode(): NetworkMode {
  // Server-side: check env variable
  if (typeof window === 'undefined') {
    const envNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
    if (envNetwork === 'mainnet') return 'mainnet';
    if (envNetwork === 'testnet') return 'testnet';
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
