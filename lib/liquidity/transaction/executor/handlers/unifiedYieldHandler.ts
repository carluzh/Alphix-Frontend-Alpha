/**
 * Unified Yield Transaction Handler
 *
 * Handles Unified Yield transaction steps:
 * - Approval: Direct ERC20 approval to Hook (no Permit2)
 * - Deposit: Add liquidity to Hook for shares
 * - Withdraw: Remove liquidity by burning shares
 *
 * Unlike V4 which uses Permit2 + PositionManager, Unified Yield uses
 * direct ERC20 approvals to the Hook contract which IS the vault.
 */

import type { Hex } from 'viem';
import type {
  UnifiedYieldApprovalStep,
  UnifiedYieldDepositStep,
  UnifiedYieldWithdrawStep,
} from '../../../types';
import { TransactionStepType } from '../../../types';

// =============================================================================
// TYPES
// =============================================================================

export type UnifiedYieldStep =
  | UnifiedYieldApprovalStep
  | UnifiedYieldDepositStep
  | UnifiedYieldWithdrawStep;

export interface HandleUnifiedYieldApprovalParams {
  address: `0x${string}`;
  step: UnifiedYieldApprovalStep;
  setCurrentStep: (params: { step: UnifiedYieldApprovalStep; accepted: boolean }) => void;
}

export interface HandleUnifiedYieldDepositParams {
  address: `0x${string}`;
  step: UnifiedYieldDepositStep;
  setCurrentStep: (params: { step: UnifiedYieldDepositStep; accepted: boolean }) => void;
}

export interface HandleUnifiedYieldWithdrawParams {
  address: `0x${string}`;
  step: UnifiedYieldWithdrawStep;
  setCurrentStep: (params: { step: UnifiedYieldWithdrawStep; accepted: boolean }) => void;
}

// =============================================================================
// TRANSACTION INFO TYPES - For transaction tracking
// =============================================================================

export interface UnifiedYieldApprovalInfo {
  type: 'UnifiedYieldApproval';
  tokenAddress: string;
  tokenSymbol: string;
  hookAddress: string;
  amount: string;
}

export interface UnifiedYieldDepositInfo {
  type: 'UnifiedYieldDeposit';
  hookAddress: string;
  poolId: string;
  sharesToMint: string;
  token0Symbol: string;
  token1Symbol: string;
}

export interface UnifiedYieldWithdrawInfo {
  type: 'UnifiedYieldWithdraw';
  hookAddress: string;
  poolId: string;
  sharesToWithdraw: string;
  token0Symbol: string;
  token1Symbol: string;
}

export type UnifiedYieldTransactionInfo =
  | UnifiedYieldApprovalInfo
  | UnifiedYieldDepositInfo
  | UnifiedYieldWithdrawInfo;

// =============================================================================
// INFO GETTERS - For transaction tracking
// =============================================================================

/**
 * Gets approval transaction info from step
 */
export function getUnifiedYieldApprovalInfo(step: UnifiedYieldApprovalStep): UnifiedYieldApprovalInfo {
  return {
    type: 'UnifiedYieldApproval',
    tokenAddress: step.tokenAddress,
    tokenSymbol: step.tokenSymbol,
    hookAddress: step.hookAddress,
    amount: step.amount.toString(),
  };
}

/**
 * Gets deposit transaction info from step
 */
export function getUnifiedYieldDepositInfo(step: UnifiedYieldDepositStep): UnifiedYieldDepositInfo {
  return {
    type: 'UnifiedYieldDeposit',
    hookAddress: step.hookAddress,
    poolId: step.poolId,
    sharesToMint: step.sharesToMint.toString(),
    token0Symbol: step.token0Symbol,
    token1Symbol: step.token1Symbol,
  };
}

/**
 * Gets withdraw transaction info from step
 */
export function getUnifiedYieldWithdrawInfo(step: UnifiedYieldWithdrawStep): UnifiedYieldWithdrawInfo {
  return {
    type: 'UnifiedYieldWithdraw',
    hookAddress: step.hookAddress,
    poolId: step.poolId,
    sharesToWithdraw: step.sharesToWithdraw.toString(),
    token0Symbol: step.token0Symbol,
    token1Symbol: step.token1Symbol,
  };
}

// =============================================================================
// UNIFIED YIELD APPROVAL HANDLER
// =============================================================================

/**
 * Handles Unified Yield approval step (direct ERC20 approval to Hook)
 *
 * Unlike V4's Permit2 flow, this is a simple ERC20 approve() call
 * directly to the Hook contract.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldApprovalStep(
  params: HandleUnifiedYieldApprovalParams,
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

  // Submit approval transaction
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
// UNIFIED YIELD DEPOSIT HANDLER
// =============================================================================

/**
 * Handles Unified Yield deposit step
 *
 * Calls Hook.addReHypothecatedLiquidity() to deposit tokens and receive shares.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldDepositStep(
  params: HandleUnifiedYieldDepositParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit deposit transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
    gasLimit: step.txRequest.gasLimit,
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
// UNIFIED YIELD WITHDRAW HANDLER
// =============================================================================

/**
 * Handles Unified Yield withdraw step
 *
 * Calls Hook.removeReHypothecatedLiquidity() to burn shares and receive tokens.
 * No approval needed - user owns the shares directly.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldWithdrawStep(
  params: HandleUnifiedYieldWithdrawParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit withdraw transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
    gasLimit: step.txRequest.gasLimit,
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
