/**
 * Unified Yield Withdraw Transaction Builder
 *
 * Builds the transaction calldata for withdrawing from a Unified Yield Hook.
 * Users burn Hook shares and receive underlying tokens (token0 + token1).
 *
 * The contract function:
 *   removeReHypothecatedLiquidity(uint256 shares, uint160 expectedSqrtPriceX96, uint24 maxPriceSlippage)
 *     external returns (BalanceDelta)
 *
 * Features:
 * - Partial withdrawals supported (any share amount)
 * - Returns both tokens proportionally based on current pool state
 * - Native ETH is unwrapped by Hook and sent to user
 * - Slippage protection via expectedSqrtPriceX96 and maxPriceSlippage (pass 0 to skip)
 */

import { encodeFunctionData, type Address, type PublicClient, formatUnits } from 'viem';
import type {
  UnifiedYieldWithdrawParams,
  UnifiedYieldWithdrawTxResult,
  UnifiedYieldWithdrawPreview,
} from './types';
import { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';

/**
 * Build a Unified Yield withdraw transaction
 *
 * Calls removeReHypothecatedLiquidity(shares, expectedSqrtPriceX96, maxPriceSlippage) on the Hook contract.
 * Burns user's shares and returns underlying tokens to sender.
 *
 * @param params - Withdraw parameters
 * @returns Transaction data ready for execution
 */
export function buildUnifiedYieldWithdrawTx(
  params: UnifiedYieldWithdrawParams
): UnifiedYieldWithdrawTxResult {
  const {
    hookAddress,
    shares,
    expectedSqrtPriceX96 = 0n, // Default to 0 to skip slippage check
    maxPriceSlippage = 0, // Default to 0 to skip slippage check
  } = params;

  // Build calldata for Hook.removeReHypothecatedLiquidity(shares, expectedSqrtPriceX96, maxPriceSlippage)
  const calldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'removeReHypothecatedLiquidity',
    args: [shares, expectedSqrtPriceX96, maxPriceSlippage],
  });

  return {
    calldata,
    value: 0n, // No ETH needed for withdrawals
    to: hookAddress,
    gasLimit: undefined, // Let wallet estimate
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Preview withdraw amounts for a given share amount
 *
 * Returns the token amounts the user would receive for burning the specified shares.
 * Uses previewRemoveReHypothecatedLiquidity which rounds down (protocol-favorable).
 *
 * @param hookAddress - Hook contract address
 * @param shares - Number of shares to burn
 * @param client - Viem public client
 * @returns Tuple of [amount0, amount1] or null on error
 */
export async function previewRemoveReHypothecatedLiquidity(
  hookAddress: Address,
  shares: bigint,
  client: PublicClient
): Promise<[bigint, bigint] | null> {
  try {
    const result = await client.readContract({
      address: hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewRemoveReHypothecatedLiquidity',
      args: [shares],
    });
    return result as [bigint, bigint];
  } catch (error) {
    console.warn(`Failed to preview remove liquidity for hook ${hookAddress}:`, error);
    return null;
  }
}

/**
 * Preview withdraw with formatted results
 *
 * Convenience function that returns full preview with formatted amounts.
 *
 * @param hookAddress - Hook contract address
 * @param shares - Number of shares to burn
 * @param token0Decimals - Decimals for token0
 * @param token1Decimals - Decimals for token1
 * @param client - Viem public client
 * @returns Full withdraw preview or null on error
 */
export async function previewWithdraw(
  hookAddress: Address,
  shares: bigint,
  token0Decimals: number,
  token1Decimals: number,
  client: PublicClient
): Promise<UnifiedYieldWithdrawPreview | null> {
  const result = await previewRemoveReHypothecatedLiquidity(hookAddress, shares, client);
  if (!result) return null;

  const [amount0, amount1] = result;

  return {
    shares,
    amount0,
    amount1,
    amount0Formatted: formatUnits(amount0, token0Decimals),
    amount1Formatted: formatUnits(amount1, token1Decimals),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// PERCENTAGE-BASED WITHDRAWALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate shares for a given withdrawal percentage
 *
 * @param totalShares - User's total share balance
 * @param percentage - Percentage to withdraw (1-100)
 * @returns Number of shares to withdraw
 */
export function calculateSharesFromPercentage(
  totalShares: bigint,
  percentage: number
): bigint {
  const clampedPercentage = Math.min(100, Math.max(1, percentage));
  if (clampedPercentage === 100) return totalShares;
  return (totalShares * BigInt(clampedPercentage)) / 100n;
}
