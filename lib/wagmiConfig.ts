// Adapted from example/frontend/config/index.tsx
import { http } from 'wagmi'
// import { cookieStorage, createStorage } from 'wagmi/storage' // Removed storage for now
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

// Define Unichain Sepolia
export const unichainSepolia = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://unichain-sepolia.drpc.org'] },
    public: { http: ['https://unichain-sepolia.drpc.org'] },
  },
  blockExplorers: {
    default: { name: 'Unichain Sepolia Blockscout', url: 'https://unichain-sepolia.blockscout.com/' },
  },
  testnet: true,
});

// Define supported networks using wagmi chains, including Unichain Sepolia
export const networks = [mainnet, polygon, arbitrum, sepolia, unichainSepolia]

// Create the Wagmi adapter instance.
// The adapter internally creates a wagmi config.
export const wagmiAdapter = new WagmiAdapter({
  networks, // Use wagmi chains
  projectId: projectId || '',
  // ssr and storage might be handled internally or need different config
  // storage: createStorage({ storage: cookieStorage }), 
  // ssr: true,
})

// Export the wagmi config property from the adapter instance
export const config = wagmiAdapter.wagmiConfig

// Removed AppKit initialization logic

// --- Initialize Reown AppKit --- 
if (!projectId) {
  // Log error but don't throw here if already checked above
  console.error('[AppKit Init] NEXT_PUBLIC_PROJECT_ID is not set.')
} 