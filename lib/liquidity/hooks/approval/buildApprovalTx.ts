/**
 * Approval Transaction Utilities
 *
 * Shared utilities for building ERC20 approval transactions.
 * Used by both V4 and Unified Yield flows.
 */

import { maxUint256, type Address } from 'viem';
import { reportError, addReportBreadcrumb } from '@/lib/observability';
import type { ValidatedTransactionRequest } from '../../types';
import { applyApprovalBuffer } from './approvalBuffer';

/**
 * Build ERC20 approve calldata for the Unified Yield flow. Exact amount + 0.001%
 * buffer (UY required amounts drift up with the Aave share price between approval
 * and deposit, ~5min cushion); infinite only when forced or no amount is known.
 */
export function buildApprovalCalldata(
  spender: Address,
  amount?: bigint,
  forceInfinite?: boolean
): `0x${string}` {
  // approve(address spender, uint256 amount)
  // Function selector: 0x095ea7b3
  const selector = '0x095ea7b3';

  // Validate spender address to catch encoding issues early
  if (!spender || typeof spender !== 'string' || !spender.startsWith('0x') || spender.length !== 42) {
    const error = new Error(`Invalid spender address format: ${spender}`);
    reportError(error, {
      domain: 'approval',
      action: 'buildCalldata',
      component: 'buildApprovalTx',
      extras: { spender, spenderType: typeof spender, spenderLength: spender?.length },
    });
    throw error;
  }

  const paddedSpender = spender.slice(2).padStart(64, '0');

  let approvalAmount: bigint;
  if (forceInfinite || !amount) {
    approvalAmount = maxUint256;
  } else {
    approvalAmount = applyApprovalBuffer(amount);
  }

  const paddedAmount = approvalAmount.toString(16).padStart(64, '0');
  const calldata = `${selector}${paddedSpender}${paddedAmount}` as `0x${string}`;

  // Validate calldata length (should be 2 + 8 + 64 + 64 = 138 chars including 0x)
  if (calldata.length !== 138) {
    const error = new Error(`Invalid calldata length: expected 138, got ${calldata.length}`);
    reportError(error, {
      domain: 'approval',
      action: 'buildCalldata',
      component: 'buildApprovalTx',
      extras: {
        spender,
        amount: amount?.toString(),
        approvalAmount: approvalAmount.toString(),
        paddedSpenderLength: paddedSpender.length,
        paddedAmountLength: paddedAmount.length,
        calldataLength: calldata.length,
        calldata,
      },
    });
    throw error;
  }

  // Add breadcrumb for debugging - will be included with any subsequent error
  addReportBreadcrumb({
    domain: 'approval',
    action: 'buildCalldata',
    message: 'Built approval calldata',
    data: {
      spender,
      amount: amount?.toString(),
      calldataLength: calldata.length,
    },
  });

  return calldata;
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
