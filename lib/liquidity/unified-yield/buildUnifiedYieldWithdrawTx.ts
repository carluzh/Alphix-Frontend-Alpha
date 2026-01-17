/**
 * Unified Yield Withdraw Transaction Builder
 *
 * Builds the transaction calldata for withdrawing from a Unified Yield Hook.
 * Users burn Hook shares and receive underlying tokens (token0 + token1).
 *
 * Features:
 * - Partial withdrawals supported (any share amount)
 * - Returns both tokens proportionally
 * - No slippage protection at contract level (basic withdraw)
 */

import { encodeFunctionData, type Address } from 'viem';
import type {
  UnifiedYieldWithdrawParams,
  UnifiedYieldWithdrawTxResult,
} from './types';
import { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';

/**
 * Build a Unified Yield withdraw transaction
 *
 * Burns user's Hook shares and returns underlying tokens to recipient.
 * Supports partial withdrawals - user can withdraw any number of shares.
 *
 * @param params - Withdraw parameters
 * @returns Transaction data ready for execution
 */
export function buildUnifiedYieldWithdrawTx(
  params: UnifiedYieldWithdrawParams
): UnifiedYieldWithdrawTxResult {
  const { hookAddress, shares, userAddress } = params;

  // Build calldata for Hook.withdraw(shares, recipient)
  const calldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'withdraw',
    args: [shares, userAddress],
  });

  return {
    calldata,
    value: 0n, // No ETH needed for withdrawals
    to: hookAddress,
    gasLimit: undefined, // Let wallet estimate
  };
}

/**
 * Estimate gas for a Unified Yield withdrawal
 *
 * @param params - Withdraw parameters
 * @param client - Viem public client
 * @returns Estimated gas limit with buffer
 */
export async function estimateUnifiedYieldWithdrawGas(
  params: UnifiedYieldWithdrawParams,
  client: any // PublicClient
): Promise<bigint> {
  const txData = buildUnifiedYieldWithdrawTx(params);

  try {
    const gasEstimate = await client.estimateGas({
      to: txData.to,
      data: txData.calldata,
      value: txData.value,
      account: params.userAddress,
    });

    // Add 20% buffer for safety
    return (gasEstimate * 120n) / 100n;
  } catch (error) {
    console.warn('Gas estimation failed for Unified Yield withdraw:', error);
    // Return reasonable default if estimation fails
    return 250_000n;
  }
}

/**
 * Validate Unified Yield withdraw parameters
 *
 * @param params - Withdraw parameters to validate
 * @returns Validation result with any error messages
 */
export function validateUnifiedYieldWithdrawParams(
  params: Partial<UnifiedYieldWithdrawParams>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.hookAddress) {
    errors.push('Hook address is required');
  }

  if (!params.userAddress) {
    errors.push('User address is required');
  }

  if (params.shares === undefined || params.shares <= 0n) {
    errors.push('Share amount must be greater than zero');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build withdraw transaction for a percentage of position
 *
 * Convenience function that calculates shares from percentage
 *
 * @param hookAddress - Hook contract address
 * @param totalShares - User's total share balance
 * @param percentage - Percentage to withdraw (1-100)
 * @param userAddress - User's wallet address
 * @param chainId - Chain ID
 * @returns Transaction data ready for execution
 */
export function buildPercentageWithdrawTx(
  hookAddress: Address,
  totalShares: bigint,
  percentage: number,
  userAddress: Address,
  chainId: number
): UnifiedYieldWithdrawTxResult {
  // Clamp percentage to valid range
  const clampedPercentage = Math.min(100, Math.max(1, percentage));

  // Calculate shares to withdraw
  const sharesToWithdraw =
    clampedPercentage === 100
      ? totalShares
      : (totalShares * BigInt(clampedPercentage)) / 100n;

  return buildUnifiedYieldWithdrawTx({
    hookAddress,
    shares: sharesToWithdraw,
    userAddress,
    poolId: '', // Not needed for tx building
    chainId,
  });
}
