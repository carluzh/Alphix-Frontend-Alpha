// Adapted from example/frontend/config/index.tsx
import { http, createStorage, cookieStorage, fallback } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, sepolia, polygon } from 'wagmi/chains' // Import chains from wagmi
import { defineChain, createClient, type Chain } from 'viem'
import { getStoredNetworkMode, MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from './network-mode'
// Removed AppKit imports

// Get Project ID from environment variable
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  console.error('Error: NEXT_PUBLIC_PROJECT_ID environment variable is not set.')
  // Consider throwing error if needed: throw new Error('NEXT_PUBLIC_PROJECT_ID is not set');
}

// --- RPC Configuration ---
const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

const testnetRpcUrls = [
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
  'https://base-sepolia.publicnode.com',
  'https://1rpc.io/base-sepolia'
];

const mainnetRpcUrls = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.publicnode.com',
  'https://1rpc.io/base'
];

// For E2E testing with Anvil fork using chain ID 1337
const isE2EMode = customRpcUrl?.includes('127.0.0.1') || customRpcUrl?.includes('localhost');

// Detect if custom RPC URL is for testnet or mainnet
const isCustomUrlTestnet = customRpcUrl?.includes('sepolia') || customRpcUrl?.includes('testnet');
const isCustomUrlMainnet = customRpcUrl?.includes('mainnet') ||
                           customRpcUrl?.includes('base.g.alchemy') ||
                           customRpcUrl?.includes('base-mainnet');

// Get current network mode - for wagmi config, use env var for default
// This is different from API routes which use cookies
// On server: use env var default (mainnet for production)
// On client: check localStorage, then env var
const networkMode = typeof window === 'undefined'
  ? (process.env.NEXT_PUBLIC_DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet')
  : getStoredNetworkMode();
const isMainnet = networkMode === 'mainnet';

// Use custom RPC URL if set (for E2E testing), otherwise use network-specific URLs
const rpcUrls = customRpcUrl ? [customRpcUrl] : (isMainnet ? mainnetRpcUrls : testnetRpcUrls);
const chainId = isE2EMode ? 1337 : (isMainnet ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID);

// Alchemy first, public RPCs as fallback
const testnetRpcUrlsFinal = isE2EMode
  ? [customRpcUrl!]
  : (isCustomUrlTestnet ? [customRpcUrl!, ...testnetRpcUrls] : testnetRpcUrls);
const mainnetRpcUrlsFinal = isCustomUrlMainnet
  ? [customRpcUrl!, ...mainnetRpcUrls]
  : mainnetRpcUrls;

export const baseSepolia = defineChain({
  id: isE2EMode ? 1337 : TESTNET_CHAIN_ID,
  name: isE2EMode ? 'Base Sepolia (local)' : 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: testnetRpcUrlsFinal
    },
    public: {
      http: testnetRpcUrlsFinal
    },
  },
  blockExplorers: {
    default: { name: 'Basescan Sepolia', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

export const baseMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: mainnetRpcUrlsFinal
    },
    public: {
      http: mainnetRpcUrlsFinal
    },
  },
  blockExplorers: {
    default: { name: 'Basescan', url: 'https://basescan.org' },
  },
  testnet: false,
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

export const activeChain = isMainnet ? baseMainnet : baseSepolia;

// Export all networks (both available for wallet switching)
// Put the default network first in the array
// Include Ethereum mainnet for ENS resolution (required for .eth name lookups)
export const networks = isMainnet
  ? [baseMainnet, baseSepolia, mainnet]
  : [baseSepolia, baseMainnet, mainnet];

/**
 * Get ordered RPC URLs for a chain (custom URL first if matching, then public fallbacks)
 * This is used by the client() function to create fallback transports
 */
function getOrderedRpcUrls(chain: Chain): string[] {
  if (chain.id === MAINNET_CHAIN_ID) {
    return mainnetRpcUrlsFinal;
  }
  if (chain.id === TESTNET_CHAIN_ID || chain.id === 1337) {
    return testnetRpcUrlsFinal;
  }
  // For other chains (like Ethereum mainnet for ENS), use default RPC
  return chain.rpcUrls.default.http as string[];
}

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