// Uniswap SDK Configuration for Alphix

import { Token } from '@uniswap/sdk-core'
import { getAddress } from 'viem'

import { BASE_CHAIN_ID, ARBITRUM_CHAIN_ID } from '@/lib/network-mode'
import { getToken } from '@/lib/pools-config'

// Stablecoins for USD pricing — derived from pool config (single source of truth)
const _usdcBase = getToken('USDC', 'base')!;
const _usdcArb = getToken('USDC', 'arbitrum')!;

const USDC_BASE = new Token(
  BASE_CHAIN_ID,
  getAddress(_usdcBase.address),
  _usdcBase.decimals,
  _usdcBase.symbol,
  _usdcBase.name
)

const USDC_ARBITRUM = new Token(
  ARBITRUM_CHAIN_ID,
  getAddress(_usdcArb.address),
  _usdcArb.decimals,
  _usdcArb.symbol,
  _usdcArb.name
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
