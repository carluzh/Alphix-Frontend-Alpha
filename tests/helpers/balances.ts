/**
 * Balance reading and verification utilities for E2E testing
 */

import { createPublicClient, http, formatUnits } from 'viem'
import { ERC20_ABI } from '../../lib/abis/erc20'
import type { TokenConfig } from '../fixtures/tokens'

const LOCAL_RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545'

const viemClient = createPublicClient({
  transport: http(LOCAL_RPC),
})

export interface BalanceSnapshot {
  token: bigint
  eth: bigint
}

/**
 * Read token and ETH balance for an address
 */
export async function readBalances(
  tokenAddress: string,
  userAddress: string
): Promise<BalanceSnapshot> {
  // Native ETH uses sentinel address - treat it specially (case-insensitive check)
  const normalizedAddress = tokenAddress.toLowerCase()
  const isNativeETH = normalizedAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
                      normalizedAddress === '0x0000000000000000000000000000000000000000'

  let tokenBalance: bigint
  if (isNativeETH) {
    // For native ETH, token balance IS the ETH balance
    tokenBalance = await viemClient.getBalance({
      address: userAddress as `0x${string}`,
    })
  } else {
    // For ERC20 tokens, read from contract
    tokenBalance = (await viemClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress as `0x${string}`],
    })) as bigint
  }

  const ethBalance = await viemClient.getBalance({
    address: userAddress as `0x${string}`,
  })

  return {
    token: tokenBalance,
    eth: ethBalance,
  }
}

/**
 * Verify swap balance changes
 */
export interface SwapVerification {
  fromToken: TokenConfig
  toToken: TokenConfig
  fromBalanceBefore: bigint
  toBalanceBefore: bigint
  ethBalanceBefore: bigint
  fromBalanceAfter: bigint
  toBalanceAfter: bigint
  ethBalanceAfter: bigint
  expectedFromDecrease: bigint
}

export function verifySwapBalances(verification: SwapVerification): {
  success: boolean
  messages: string[]
} {
  const messages: string[] = []
  let success = true

  // Check if we're swapping native ETH (either from or to)
  const normalizedFromAddress = verification.fromToken.address.toLowerCase()
  const normalizedToAddress = verification.toToken.address.toLowerCase()
  const isFromNativeETH = normalizedFromAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
                          normalizedFromAddress === '0x0000000000000000000000000000000000000000'
  const isToNativeETH = normalizedToAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
                        normalizedToAddress === '0x0000000000000000000000000000000000000000'

  // Log balance changes
  messages.push(
    `  ${verification.fromToken.symbol}: ${formatUnits(verification.fromBalanceAfter, verification.fromToken.decimals)} (was ${formatUnits(verification.fromBalanceBefore, verification.fromToken.decimals)})`
  )
  messages.push(
    `  ${verification.toToken.symbol}: ${formatUnits(verification.toBalanceAfter, verification.toToken.decimals)} (was ${formatUnits(verification.toBalanceBefore, verification.toToken.decimals)})`
  )
  messages.push(
    `  ETH: ${formatUnits(verification.ethBalanceAfter, 18)} (was ${formatUnits(verification.ethBalanceBefore, 18)})`
  )

  // Verify fromToken decreased by expected amount
  const actualDecrease = verification.fromBalanceBefore - verification.fromBalanceAfter
  if (actualDecrease === verification.expectedFromDecrease) {
    messages.push(
      `  ${verification.fromToken.symbol} decreased by exactly ${formatUnits(verification.expectedFromDecrease, verification.fromToken.decimals)}`
    )
  } else {
    messages.push(
      `  Warning: ${verification.fromToken.symbol} decreased by ${formatUnits(actualDecrease, verification.fromToken.decimals)} (expected ${formatUnits(verification.expectedFromDecrease, verification.fromToken.decimals)})`
    )
  }

  // Verify toToken increased
  const toTokenIncrease = verification.toBalanceAfter - verification.toBalanceBefore
  if (toTokenIncrease > BigInt(0)) {
    messages.push(
      `  ${verification.toToken.symbol} increased by ${formatUnits(toTokenIncrease, verification.toToken.decimals)}`
    )
  } else {
    messages.push(`  Error: ${verification.toToken.symbol} balance did not increase`)
    success = false
  }

  // Verify ETH balance change - special handling for native ETH swaps
  const ethChange = verification.ethBalanceAfter - verification.ethBalanceBefore
  if (isFromNativeETH) {
    // When swapping FROM native ETH, we expect ETH to decrease (swap amount + gas)
    if (ethChange < BigInt(0)) {
      messages.push(`  ETH decreased by ${formatUnits(-ethChange, 18)} (includes swap + gas)`)
    } else {
      messages.push(`  Error: ETH should have decreased (swapping FROM ETH)`)
      success = false
    }
  } else if (isToNativeETH) {
    // When swapping TO native ETH, we expect ETH to increase (swap output - gas)
    // Gas is always paid, so net change might be positive or negative depending on swap size
    messages.push(`  ETH changed by ${ethChange >= 0 ? '+' : ''}${formatUnits(ethChange, 18)} (swap output - gas)`)
    // Don't fail if ETH didn't increase - gas might have offset the gains
  } else {
    // Normal ERC20 → ERC20 swap, ETH should only decrease (gas)
    if (ethChange < BigInt(0)) {
      messages.push(`  ETH decreased by ${formatUnits(-ethChange, 18)} (gas)`)
    } else {
      messages.push(`  Warning: ETH balance did not decrease (expected gas payment)`)
    }
  }

  return { success, messages }
}
