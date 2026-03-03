/**
 * Aggregator Approval Utilities
 *
 * Handles checking and managing token approvals for aggregator routers.
 */

import { type Address, type PublicClient, erc20Abi } from 'viem';
import { type ApprovalStatus, isNativeToken } from './types';
import { getKyberswapRouterAddress } from './kyberswap';

/**
 * Check if a token needs approval for the Kyberswap router
 */
export async function checkKyberswapApproval(
  tokenAddress: string,
  userAddress: string,
  requiredAmount: bigint,
  publicClient: PublicClient
): Promise<ApprovalStatus> {
  const routerAddress = getKyberswapRouterAddress();

  // Native tokens don't need approval
  if (isNativeToken(tokenAddress)) {
    return {
      needsApproval: false,
      spender: routerAddress,
      token: tokenAddress,
      currentAllowance: BigInt(0),
      requiredAmount,
    };
  }

  try {
    const currentAllowance = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAddress as Address, routerAddress as Address],
    });

    return {
      needsApproval: currentAllowance < requiredAmount,
      spender: routerAddress,
      token: tokenAddress,
      currentAllowance,
      requiredAmount,
    };
  } catch (error) {
    console.error('[Approval] Failed to check allowance:', error);
    // Assume approval needed if check fails
    return {
      needsApproval: true,
      spender: routerAddress,
      token: tokenAddress,
      currentAllowance: BigInt(0),
      requiredAmount,
    };
  }
}

/**
 * Build approval transaction data for Kyberswap router
 */
export function buildApprovalData(
  tokenAddress: string,
  amount: bigint
): { to: Address; data: `0x${string}` } {
  const routerAddress = getKyberswapRouterAddress();

  // Encode approve(spender, amount) call
  // Function selector: 0x095ea7b3
  const selector = '0x095ea7b3';
  const paddedSpender = routerAddress.slice(2).toLowerCase().padStart(64, '0');
  const paddedAmount = amount.toString(16).padStart(64, '0');

  return {
    to: tokenAddress as Address,
    data: `${selector}${paddedSpender}${paddedAmount}` as `0x${string}`,
  };
}

/**
 * Maximum uint256 for infinite approval
 */
export const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

/**
 * Build infinite approval transaction data
 */
export function buildInfiniteApprovalData(
  tokenAddress: string
): { to: Address; data: `0x${string}` } {
  return buildApprovalData(tokenAddress, MAX_UINT256);
}
