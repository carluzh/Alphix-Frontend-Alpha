import type { TypedDataDomain } from 'abitype'
import type { Address } from 'viem'

type TypedDataField = { name: string; type: string }

// EIP-712 type definitions for Permit2
const PERMIT_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

const PERMIT_BATCH_TYPES = {
  PermitBatch: [
    { name: 'details', type: 'PermitDetails[]' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

export const PERMIT2_TYPES = {
  ...PERMIT_TYPES,
  ...PERMIT_BATCH_TYPES,
} as const

// Copied from Uniswap: interface/packages/uniswap/src/features/transactions/steps/permit2Signature.ts
export interface SignTypedDataStepFields {
  domain: TypedDataDomain
  types: Record<string, TypedDataField[]>
  values: Record<string, unknown>
}

// Permit batch data structure (matches API response)
export interface BatchPermitData {
  domain: TypedDataDomain
  types: Record<string, TypedDataField[]>
  values: {
    details: Array<{ token: string; amount: string; expiration: string; nonce: string }>
    spender: string
    sigDeadline: string
  }
}

// Cached permit for recovery (C3)
export interface CachedPermit {
  permitBatchData: BatchPermitData
  signature: string
  timestamp: number
  flowId?: string
  userAddress: Address
  chainId: number
  token0Symbol: string
  token1Symbol: string
  tickLower: number
  tickUpper: number
}

// C3: Permit cache key
function getPermitCacheKey(userAddress: string, chainId: number, token0: string, token1: string): string {
  return `permit_${userAddress}_${chainId}_${token0}_${token1}`
}

// C3: Cache signed permit
export function cacheSignedPermit(permit: CachedPermit): void {
  try {
    const key = getPermitCacheKey(permit.userAddress, permit.chainId, permit.token0Symbol, permit.token1Symbol)
    sessionStorage.setItem(key, JSON.stringify(permit))
  } catch {}
}

// C3: Clear cached permit
export function clearCachedPermit(userAddress: string, chainId: number, token0Symbol: string, token1Symbol: string): void {
  try {
    const key = getPermitCacheKey(userAddress, chainId, token0Symbol, token1Symbol)
    sessionStorage.removeItem(key)
  } catch {}
}
