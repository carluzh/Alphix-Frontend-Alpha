import type { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'
import type { PublicClient, Address } from 'viem'

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

// EIP-712 type definitions for Permit2
export const PERMIT_TYPES = {
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

export const PERMIT_BATCH_TYPES = {
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

// Flow recovery data (C4)
export interface FlowRecoveryData {
  canResume: boolean
  skipToken0Approval: boolean
  skipToken1Approval: boolean
  cachedPermit: CachedPermit | null
  skipSteps: {
    token0Approval: boolean
    token1Approval: boolean
    permitSign: boolean
  }
  recoveryMessage?: string
}

// Flow state for step tracking (C4)
export interface TransactionFlowState {
  flowId: string
  userAddress: Address
  chainId: number
  token0Symbol: string
  token1Symbol: string
  tickLower: number
  tickUpper: number
  startedAt: number
  completedSteps: Record<string, { txHash?: string; timestamp: number }>
  failedAt?: number
  failureReason?: string
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

// C3: Get cached permit
export function getCachedPermit(
  userAddress: string,
  chainId: number,
  token0Symbol: string,
  token1Symbol: string,
  tickLower: number,
  tickUpper: number
): CachedPermit | null {
  try {
    const key = getPermitCacheKey(userAddress, chainId, token0Symbol, token1Symbol)
    const cached = sessionStorage.getItem(key)
    if (!cached) return null
    const permit = JSON.parse(cached) as CachedPermit
    if (permit.tickLower !== tickLower || permit.tickUpper !== tickUpper) return null
    if (Date.now() - permit.timestamp > 2 * 60 * 60 * 1000) return null // 2 hour expiry
    return permit
  } catch {
    return null
  }
}

// C3: Clear cached permit
export function clearCachedPermit(userAddress: string, chainId: number, token0Symbol: string, token1Symbol: string): void {
  try {
    const key = getPermitCacheKey(userAddress, chainId, token0Symbol, token1Symbol)
    sessionStorage.removeItem(key)
  } catch {}
}

// C3: Check if permit is expired
export function isPermitExpired(permitBatchData: BatchPermitData): boolean {
  const deadline = parseInt(permitBatchData.values.sigDeadline, 10)
  return Date.now() / 1000 > deadline
}

// C4: Flow state cache key
function getFlowCacheKey(userAddress: string, chainId: number, token0: string, token1: string, tickLower: number, tickUpper: number): string {
  return `flow_${userAddress}_${chainId}_${token0}_${token1}_${tickLower}_${tickUpper}`
}

// C4: Generate unique flow ID
function generateFlowId(): string {
  return `flow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// C4: Get or create flow state
export function getOrCreateFlowState(
  userAddress: Address,
  chainId: number,
  token0Symbol: string,
  token1Symbol: string,
  tickLower: number,
  tickUpper: number
): TransactionFlowState {
  try {
    const key = getFlowCacheKey(userAddress, chainId, token0Symbol, token1Symbol, tickLower, tickUpper)
    const cached = sessionStorage.getItem(key)
    if (cached) {
      const state = JSON.parse(cached) as TransactionFlowState
      if (Date.now() - state.startedAt < 2 * 60 * 60 * 1000) return state // 2 hour expiry
    }
  } catch {}

  const state: TransactionFlowState = {
    flowId: generateFlowId(),
    userAddress,
    chainId,
    token0Symbol,
    token1Symbol,
    tickLower,
    tickUpper,
    startedAt: Date.now(),
    completedSteps: {},
  }

  try {
    const key = getFlowCacheKey(userAddress, chainId, token0Symbol, token1Symbol, tickLower, tickUpper)
    sessionStorage.setItem(key, JSON.stringify(state))
  } catch {}

  return state
}

// C4: Update flow step
export function updateFlowStepComplete(flowId: string, stepKey: string, data: { txHash?: string; timestamp: number } | CachedPermit): void {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('flow_')) {
        const cached = sessionStorage.getItem(key)
        if (cached) {
          const state = JSON.parse(cached) as TransactionFlowState
          if (state.flowId === flowId) {
            state.completedSteps[stepKey] = 'signature' in data ? { timestamp: data.timestamp } : data
            sessionStorage.setItem(key, JSON.stringify(state))
            return
          }
        }
      }
    }
  } catch {}
}

// C4: Mark flow as failed
export function markFlowFailed(flowId: string, reason: string): void {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('flow_')) {
        const cached = sessionStorage.getItem(key)
        if (cached) {
          const state = JSON.parse(cached) as TransactionFlowState
          if (state.flowId === flowId) {
            state.failedAt = Date.now()
            state.failureReason = reason
            sessionStorage.setItem(key, JSON.stringify(state))
            return
          }
        }
      }
    }
  } catch {}
}

// C4: Clear flow state
export function clearFlowState(flowId: string): void {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('flow_')) {
        const cached = sessionStorage.getItem(key)
        if (cached) {
          const state = JSON.parse(cached) as TransactionFlowState
          if (state.flowId === flowId) {
            sessionStorage.removeItem(key)
            return
          }
        }
      }
    }
  } catch {}
}

// C4: Attempt to recover previous flow
export async function attemptFlowRecovery(
  publicClient: PublicClient,
  userAddress: Address,
  chainId: number,
  token0Symbol: string,
  token1Symbol: string,
  token0Address: string,
  token1Address: string,
  spender: string,
  tickLower: number,
  tickUpper: number,
  amount0Required: bigint,
  amount1Required: bigint
): Promise<FlowRecoveryData | null> {
  const key = getFlowCacheKey(userAddress, chainId, token0Symbol, token1Symbol, tickLower, tickUpper)
  try {
    const cached = sessionStorage.getItem(key)
    if (!cached) return null

    const state = JSON.parse(cached) as TransactionFlowState
    if (Date.now() - state.startedAt > 2 * 60 * 60 * 1000) {
      sessionStorage.removeItem(key)
      return null
    }

    // Check if approvals are still valid on-chain (Permit2 allowance: owner, token, spender)
    const permit2Abi = [{ inputs: [{ name: 'owner', type: 'address' }, { name: 'token', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], stateMutability: 'view', type: 'function' }] as const
    const [result0, result1] = await Promise.all([
      publicClient.readContract({
        address: PERMIT2_ADDRESS as Address,
        abi: permit2Abi,
        functionName: 'allowance',
        args: [userAddress, token0Address as Address, spender as Address],
      }).catch(() => [0n, 0, 0n] as const),
      publicClient.readContract({
        address: PERMIT2_ADDRESS as Address,
        abi: permit2Abi,
        functionName: 'allowance',
        args: [userAddress, token1Address as Address, spender as Address],
      }).catch(() => [0n, 0, 0n] as const),
    ])
    const allowance0 = result0[0]
    const allowance1 = result1[0]

    const skipToken0Approval = !!state.completedSteps['token0Approval'] && allowance0 >= amount0Required
    const skipToken1Approval = !!state.completedSteps['token1Approval'] && allowance1 >= amount1Required
    const cachedPermit = getCachedPermit(userAddress, chainId, token0Symbol, token1Symbol, tickLower, tickUpper)
    const skipPermitSign = !!cachedPermit && !isPermitExpired(cachedPermit.permitBatchData)

    const skippedSteps: string[] = []
    if (skipToken0Approval) skippedSteps.push('token0 approval')
    if (skipToken1Approval) skippedSteps.push('token1 approval')
    if (skipPermitSign) skippedSteps.push('permit signature')

    return {
      canResume: skipToken0Approval || skipToken1Approval || skipPermitSign,
      skipToken0Approval,
      skipToken1Approval,
      cachedPermit,
      skipSteps: {
        token0Approval: skipToken0Approval,
        token1Approval: skipToken1Approval,
        permitSign: skipPermitSign,
      },
      recoveryMessage: skippedSteps.length > 0 ? `Resuming: skipping ${skippedSteps.join(', ')}` : undefined,
    }
  } catch {
    return null
  }
}
