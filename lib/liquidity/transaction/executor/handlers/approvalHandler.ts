/**
 * Approval Transaction Handler
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/transactions/utils.ts
 *
 * Handles token approval and revocation transactions.
 * Adapted from Redux Saga to async/await with wagmi hooks.
 */

import { type Hex } from 'viem';
import type { Config } from 'wagmi';
import type {
  TokenApprovalTransactionStep,
  TokenRevocationTransactionStep,
  Permit2TransactionStep,
} from '../../../types';
import { TransactionStepType } from '../../../types';
import { parseERC20ApproveCalldata } from '../../steps';

// =============================================================================
// TYPES - Matches Uniswap's HandleApprovalStepParams
// =============================================================================

export interface HandleApprovalStepParams {
  address: `0x${string}`;
  step: TokenApprovalTransactionStep | TokenRevocationTransactionStep;
  setCurrentStep: (params: { step: TokenApprovalTransactionStep | TokenRevocationTransactionStep; accepted: boolean }) => void;
}

export interface HandlePermitTransactionParams {
  address: `0x${string}`;
  step: Permit2TransactionStep;
  setCurrentStep: (params: { step: Permit2TransactionStep; accepted: boolean }) => void;
}

export interface ApproveTransactionInfo {
  type: 'Approve';
  tokenAddress: string;
  spender: string;
  approvalAmount: string;
}

export interface Permit2ApproveTransactionInfo {
  type: 'Permit2Approve';
  tokenAddress: string;
  spender: string;
  amount: string;
}

// =============================================================================
// APPROVAL TRANSACTION INFO - COPIED FROM UNISWAP utils.ts lines 374-383
// =============================================================================

/**
 * Gets approval transaction info from step
 * COPIED FROM interface/apps/web/src/state/sagas/transactions/utils.ts
 */
export function getApprovalTransactionInfo(
  approvalStep: TokenApprovalTransactionStep | TokenRevocationTransactionStep | Permit2TransactionStep,
): ApproveTransactionInfo {
  return {
    type: 'Approve',
    tokenAddress: approvalStep.token.address,
    spender: approvalStep.spender,
    approvalAmount: approvalStep.amount,
  };
}

/**
 * Gets permit transaction info from step
 * COPIED FROM interface/apps/web/src/state/sagas/transactions/utils.ts lines 385-392
 */
export function getPermitTransactionInfo(approvalStep: Permit2TransactionStep): Permit2ApproveTransactionInfo {
  return {
    type: 'Permit2Approve',
    tokenAddress: approvalStep.token.address,
    spender: approvalStep.spender,
    amount: approvalStep.amount,
  };
}

// =============================================================================
// CHECK APPROVAL AMOUNT - COPIED FROM UNISWAP utils.ts lines 394-405
// =============================================================================

/**
 * Checks if the approval amount submitted matches the required amount
 * COPIED FROM interface/apps/web/src/state/sagas/transactions/utils.ts
 */
export function checkApprovalAmount(
  data: string,
  step: TokenApprovalTransactionStep | TokenRevocationTransactionStep,
): { isInsufficient: boolean; approvedAmount: string } {
  const requiredAmount = BigInt(`0x${parseInt(step.amount, 10).toString(16)}`);
  const submitted = parseERC20ApproveCalldata(data);
  const approvedAmount = submitted.amount.toString(10);

  // Special case: for revoke tx's, the approval is insufficient if anything other than an empty approval was submitted on chain.
  if (step.type === TransactionStepType.TokenRevocationTransaction) {
    return { isInsufficient: submitted.amount !== BigInt(0), approvedAmount };
  }

  return { isInsufficient: submitted.amount < requiredAmount, approvedAmount };
}

// =============================================================================
// APPROVAL HANDLER - Adapted from UNISWAP utils.ts lines 348-372
// =============================================================================

/**
 * Handles approval transaction step
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/transactions/utils.ts
 * Original uses Redux Saga yield* call pattern, adapted to async/await
 *
 * @param params - Handler parameters including address, step, and callbacks
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleApprovalTransactionStep(
  params: HandleApprovalStepParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
  });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    throw new Error(`${step.type} transaction reverted`);
  }

  return hash;
}

// =============================================================================
// PERMIT TRANSACTION HANDLER - Adapted from UNISWAP utils.ts lines 342-346
// =============================================================================

/**
 * Handles permit2 transaction step
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/transactions/utils.ts
 *
 * @param params - Handler parameters including address, step, and callbacks
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handlePermitTransactionStep(
  params: HandlePermitTransactionParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
  });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    throw new Error('Permit2 transaction reverted');
  }

  return hash;
}
