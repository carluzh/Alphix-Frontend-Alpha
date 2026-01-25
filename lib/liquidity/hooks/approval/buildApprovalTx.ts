/**
 * Approval Transaction Utilities
 *
 * Shared utilities for building ERC20 approval transactions.
 * Used by both V4 and Unified Yield flows.
 */

import { maxUint256, type Address } from 'viem';
import { getStoredUserSettings } from '@/hooks/useUserSettings';
import type { ValidatedTransactionRequest } from '../../types';

/**
 * Build ERC20 approve calldata
 * Respects user's approval mode setting (exact vs infinite)
 *
 * @param spender - Address to approve
 * @param amount - Exact amount to approve (used when approvalMode is 'exact')
 * @param forceInfinite - Force infinite approval regardless of settings
 * @returns Encoded approve(address,uint256) calldata
 */
export function buildApprovalCalldata(
  spender: Address,
  amount?: bigint,
  forceInfinite?: boolean
): `0x${string}` {
  // approve(address spender, uint256 amount)
  // Function selector: 0x095ea7b3
  const selector = '0x095ea7b3';
  const paddedSpender = spender.slice(2).padStart(64, '0');

  // Determine approval amount based on user settings
  let approvalAmount: bigint;
  if (forceInfinite) {
    approvalAmount = maxUint256;
  } else {
    const userSettings = getStoredUserSettings();
    approvalAmount = userSettings.approvalMode === 'infinite' ? maxUint256 : (amount ?? maxUint256);
  }

  const paddedAmount = approvalAmount.toString(16).padStart(64, '0');
  return `${selector}${paddedSpender}${paddedAmount}` as `0x${string}`;
}

/**
 * Parameters for building approval requests
 */
export interface BuildApprovalRequestsParams {
  /** Whether token0 needs approval */
  needsToken0: boolean;
  /** Whether token1 needs approval */
  needsToken1: boolean;
  /** Token0 contract address */
  token0Address: Address;
  /** Token1 contract address */
  token1Address: Address;
  /** Spender address (Permit2 for V4, Hook for UY) */
  spender: Address;
  /** Amount of token0 (in wei) */
  amount0: bigint;
  /** Amount of token1 (in wei) */
  amount1: bigint;
  /** Chain ID */
  chainId: number;
  /** Force infinite approval */
  forceInfinite?: boolean;
}

/**
 * Build approval transaction requests for tokens that need approval
 * Shared by both V4 and Unified Yield flows
 *
 * @param params - Approval request parameters
 * @returns Object with token0 and/or token1 approval requests
 */
export function buildApprovalRequests(params: BuildApprovalRequestsParams): {
  token0?: ValidatedTransactionRequest;
  token1?: ValidatedTransactionRequest;
} {
  const result: { token0?: ValidatedTransactionRequest; token1?: ValidatedTransactionRequest } = {};

  if (params.needsToken0) {
    result.token0 = {
      to: params.token0Address,
      data: buildApprovalCalldata(params.spender, params.amount0, params.forceInfinite),
      value: 0n,
      chainId: params.chainId,
    };
  }

  if (params.needsToken1) {
    result.token1 = {
      to: params.token1Address,
      data: buildApprovalCalldata(params.spender, params.amount1, params.forceInfinite),
      value: 0n,
      chainId: params.chainId,
    };
  }

  return result;
}
