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



// Define Base Sepolia
export const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org', 'https://base-sepolia.drpc.org'] },
    public: { http: ['https://sepolia.base.org', 'https://base-sepolia.drpc.org'] },
  },
  blockExplorers: {
    default: { name: 'Basescan Sepolia', url: 'https://sepolia.basescan.org' }, // Added Basescan
  },
  testnet: true,
});

export const networks = [baseSepolia] // Added baseSepolia

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