// Uniswap SDK Configuration for Alphix

import { Token } from '@uniswap/sdk-core'

export const BASE_CHAIN_ID = 8453
export const BASE_SEPOLIA_CHAIN_ID = 84532

// Stablecoins for USD pricing
export const USDC_BASE = new Token(
  BASE_CHAIN_ID,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  6,
  'USDC',
  'USD Coin'
)

export const USDC_BASE_SEPOLIA = new Token(
  BASE_SEPOLIA_CHAIN_ID,
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  6,
  'USDC',
  'USD Coin'
)

export function getStablecoin(chainId: number): Token | undefined {
  switch (chainId) {
    case BASE_CHAIN_ID:
      return USDC_BASE
    case BASE_SEPOLIA_CHAIN_ID:
      return USDC_BASE_SEPOLIA
    default:
      return undefined
  }
}

// Polling intervals (ms)
export const PollingInterval = {
  Slow: 60000,
  Normal: 15000,
  Fast: 5000,
  LightningMcQueen: 1000,
} as const

export type PollingIntervalValue = (typeof PollingInterval)[keyof typeof PollingInterval]
