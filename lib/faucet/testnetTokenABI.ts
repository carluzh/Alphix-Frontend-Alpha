/**
 * Testnet Token ABI
 *
 * ABI for the Alphix testnet tokens (atDAI and atUSDC).
 * These tokens have a public mint function for testnet use.
 */

export const testnetTokenABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

// Token addresses for Base Sepolia testnet
export const TESTNET_TOKENS = {
  atDAI: {
    address: '0x5ae7Ce909022a2B031C31872af5Dfa796F233Aa5' as const,
    symbol: 'atDAI',
    decimals: 18,
    icon: '/tokens/aDAI.png',
    // Mint 1000 atDAI (18 decimals)
    mintAmount: '1000000000000000000000',
  },
  atUSDC: {
    address: '0xFADB34a7e6F1D263053d05987408bA5cFF60B4f1' as const,
    symbol: 'atUSDC',
    decimals: 6,
    icon: '/tokens/aUSDC.png',
    // Mint 1000 atUSDC (6 decimals)
    mintAmount: '1000000000',
  },
} as const;

// Chain ID for Base Sepolia
export const BASE_SEPOLIA_CHAIN_ID = 84532;
