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
import { reportFailedTx, markReported } from '@/lib/observability';
import type {
  TokenApprovalTransactionStep,
  TokenRevocationTransactionStep,
  Permit2TransactionStep,
} from '../../../types';

// =============================================================================
// TYPES - Matches Uniswap's HandleApprovalStepParams
// =============================================================================

export interface HandleApprovalStepParams {
  address: `0x${string}`;
  step: TokenApprovalTransactionStep | TokenRevocationTransactionStep;
  setCurrentStep: (params: { step: TokenApprovalTransactionStep | TokenRevocationTransactionStep; accepted: boolean }) => void;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
}

export interface HandlePermitTransactionParams {
  address: `0x${string}`;
  step: Permit2TransactionStep;
  setCurrentStep: (params: { step: Permit2TransactionStep; accepted: boolean }) => void;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
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
  const { step, setCurrentStep, address, chainId } = params;

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
    // Decode the revert reason via a read-only eth_call replay (does NOT touch the
    // audited send path). Previously this site had no diagnostics — now it groups
    // by decoded short-message.
    await reportFailedTx(null, {
      domain: 'approval',
      action: 'erc20Approve',
      component: 'approvalHandler',
      txHash: hash,
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
      from: address,
      chainId,
      extras: { stepType: step.type, userAddress: address },
    });
    throw markReported(new Error(`${step.type} transaction reverted`));
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
  const { step, setCurrentStep, address, chainId } = params;

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
    // Decode the revert reason via a read-only eth_call replay (does NOT touch the
    // audited send path). Previously this site had no diagnostics.
    await reportFailedTx(null, {
      domain: 'approval',
      action: 'permit2',
      component: 'approvalHandler',
      txHash: hash,
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
      from: address,
      chainId,
      extras: { stepType: step.type, userAddress: address },
    });
    throw markReported(new Error('Permit2 transaction reverted'));
  }

  return hash;
}
