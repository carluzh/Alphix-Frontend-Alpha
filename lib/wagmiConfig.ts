// Adapted from example/frontend/config/index.tsx
import { http, createStorage, cookieStorage, fallback } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet } from 'wagmi/chains' // Ethereum mainnet for ENS resolution
import { createClient } from 'viem'
import { getStoredNetworkMode, MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from './network-mode'
// Import chain definitions from chains.ts (shared with viemClient.ts)
import { baseSepolia, baseMainnet, getOrderedRpcUrls } from './chains'

// Re-export chain definitions for backwards compatibility
export { baseSepolia, baseMainnet }

// Get Project ID from environment variable
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  console.error('Error: NEXT_PUBLIC_PROJECT_ID environment variable is not set.')
}

// Get current network mode - for wagmi config, use env var for default
// This is different from API routes which use cookies
// On server: use env var default (mainnet for production)
// On client: check localStorage, then env var
const networkMode = typeof window === 'undefined'
  ? (process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet')
  : getStoredNetworkMode();
const isMainnet = networkMode === 'mainnet';
const chainId = isMainnet ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;

export const activeChain = isMainnet ? baseMainnet : baseSepolia;

// Export all networks (both available for wallet switching)
// Put the default network first in the array
// Include Ethereum mainnet for ENS resolution (required for .eth name lookups)
export const networks = isMainnet
  ? [baseMainnet, baseSepolia, mainnet]
  : [baseSepolia, baseMainnet, mainnet];

// Create the Wagmi adapter instance.
// The adapter internally creates a wagmi config.
// We pass a custom client() function to enable multicall batching (like Uniswap).
// @see interface/apps/web/src/components/Web3Provider/wagmiConfig.ts
export const wagmiAdapter = new WagmiAdapter({
  networks, // Both networks available
  projectId: projectId || '',
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  // Custom client configuration with multicall batching enabled
  // This batches multiple RPC calls into single multicall requests
  client({ chain }) {
    const urls = getOrderedRpcUrls(chain);
    return createClient({
      chain,
      batch: { multicall: true },
      pollingInterval: 12_000, // 12 seconds (same as Uniswap)
      transport: fallback(
        urls.map((url) => http(url, { timeout: 10_000 }))
      ),
    });
  },
})

export const config = wagmiAdapter.wagmiConfig

if (!projectId) {
  // Log error but don't throw here if already checked above
  console.error('[AppKit Init] NEXT_PUBLIC_PROJECT_ID is not set.')
}

// Export helpers for network-aware code
export { isMainnet, networkMode, chainId as activeChainId }

/**
 * Get the block explorer URL for the active chain
 */
export function getExplorerUrl(): string {
  return activeChain.blockExplorers?.default?.url || 'https://basescan.org';
}

/**
 * Get the block explorer URL for a transaction
 */
export function getExplorerTxUrl(txHash: string): string {
  const baseUrl = getExplorerUrl();
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Get the block explorer URL for an address
 */
export function getExplorerAddressUrl(address: string): string {
  const baseUrl = getExplorerUrl();
  return `${baseUrl}/address/${address}`;
} 