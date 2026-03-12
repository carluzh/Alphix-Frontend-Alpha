// Uniswap SDK Configuration for Alphix

import { Token } from '@uniswap/sdk-core'

import { BASE_CHAIN_ID, ARBITRUM_CHAIN_ID } from '@/lib/network-mode'

// Stablecoins for USD pricing
export const USDC_BASE = new Token(
  BASE_CHAIN_ID,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  6,
  'USDC',
  'USD Coin'
)

export const USDC_ARBITRUM = new Token(
  ARBITRUM_CHAIN_ID,
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  6,
  'USDC',
  'USD Coin'
)

export function getStablecoin(chainId: number): Token | undefined {
  switch (chainId) {
    case BASE_CHAIN_ID:
      return USDC_BASE
    case ARBITRUM_CHAIN_ID:
      return USDC_ARBITRUM
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
