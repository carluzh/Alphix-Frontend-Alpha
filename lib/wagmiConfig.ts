// Adapted from example/frontend/config/index.tsx
import { http, createStorage, cookieStorage } from 'wagmi'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, sepolia, polygon } from 'wagmi/chains' // Import chains from wagmi
import { defineChain } from 'viem'
// Removed AppKit imports

// Get Project ID from environment variable
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID

if (!projectId) {
  console.error('Error: NEXT_PUBLIC_PROJECT_ID environment variable is not set.')
  // Consider throwing error if needed: throw new Error('NEXT_PUBLIC_PROJECT_ID is not set');
}



// Define Base Sepolia with support for custom RPC URL (for E2E testing with Anvil fork)
const customRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
const defaultRpcUrls = [
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
  'https://base-sepolia.publicnode.com',
  'https://1rpc.io/base-sepolia'
];

// Use custom RPC URL if set (for E2E testing), otherwise use default URLs
const rpcUrls = customRpcUrl ? [customRpcUrl] : defaultRpcUrls;

// For E2E testing with Anvil fork using chain ID 1337
const isE2EMode = customRpcUrl?.includes('127.0.0.1') || customRpcUrl?.includes('localhost');
const chainId = isE2EMode ? 1337 : 84532;

export const baseSepolia = defineChain({
  id: chainId,
  name: isE2EMode ? 'Base Sepolia (local)' : 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { 
      http: rpcUrls
    },
    public: { 
      http: rpcUrls
    },
  },
  blockExplorers: {
    default: { name: 'Basescan Sepolia', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
  // Provide Multicall3 deployment so viem can batch calls on Base Sepolia
  contracts: {
    multicall3: {
      // Standard Multicall3 address deployed on many chains (including Base testnets)
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

export const networks = [baseSepolia] // Added baseSepolia

// Create the Wagmi adapter instance.
// The adapter internally creates a wagmi config.
export const wagmiAdapter = new WagmiAdapter({
  networks, // Use wagmi chains
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