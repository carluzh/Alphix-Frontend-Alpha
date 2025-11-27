// Adapted from example/frontend/config/index.tsx
import { http, createStorage, cookieStorage } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, sepolia, polygon } from 'wagmi/chains' // Import chains from wagmi
import { defineChain } from 'viem'
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

// Testnet RPC URLs (Base Sepolia)
const testnetRpcUrls = [
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
  'https://base-sepolia.publicnode.com',
  'https://1rpc.io/base-sepolia'
];

// Mainnet RPC URLs (Base Mainnet)
const mainnetRpcUrls = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
  'https://base.publicnode.com',
  'https://1rpc.io/base'
];

// For E2E testing with Anvil fork using chain ID 1337
const isE2EMode = customRpcUrl?.includes('127.0.0.1') || customRpcUrl?.includes('localhost');

// Get current network mode from localStorage (defaults to testnet)
const networkMode = getStoredNetworkMode();
const isMainnet = networkMode === 'mainnet';

// Use custom RPC URL if set (for E2E testing), otherwise use network-specific URLs
const rpcUrls = customRpcUrl ? [customRpcUrl] : (isMainnet ? mainnetRpcUrls : testnetRpcUrls);
const chainId = isE2EMode ? 1337 : (isMainnet ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID);

// Define Base Sepolia
export const baseSepolia = defineChain({
  id: isE2EMode ? 1337 : TESTNET_CHAIN_ID,
  name: isE2EMode ? 'Base Sepolia (local)' : 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: customRpcUrl ? [customRpcUrl] : testnetRpcUrls
    },
    public: {
      http: customRpcUrl ? [customRpcUrl] : testnetRpcUrls
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

// Define Base Mainnet
export const baseMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: mainnetRpcUrls
    },
    public: {
      http: mainnetRpcUrls
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

// Get active chain based on network mode
export const activeChain = isMainnet ? baseMainnet : baseSepolia;

// Export all networks (both available for wallet switching)
export const networks = [baseSepolia, baseMainnet];

// Create the Wagmi adapter instance.
// The adapter internally creates a wagmi config.
export const wagmiAdapter = new WagmiAdapter({
  networks, // Both networks available
  projectId: projectId || '',
  // ssr and storage might be handled internally or need different config
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
})

// Export the wagmi config property from the adapter instance
export const config = wagmiAdapter.wagmiConfig

// Removed AppKit initialization logic

// --- Initialize Reown AppKit ---
if (!projectId) {
  // Log error but don't throw here if already checked above
  console.error('[AppKit Init] NEXT_PUBLIC_PROJECT_ID is not set.')
}

// Export helpers for network-aware code
export { isMainnet, networkMode, chainId as activeChainId } 