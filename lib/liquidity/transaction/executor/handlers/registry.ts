/**
 * Step Handler Registry
 *
 * Maps TransactionStepType to handler functions for cleaner execution flow.
 * This registry pattern makes adding new step types trivial - just add an entry.
 *
 * Note: Signature steps (Permit2Signature) are handled separately as they
 * return a signature rather than executing a transaction.
 */

import type { Hex } from 'viem';
import type {
  TransactionStep,
  TokenApprovalTransactionStep,
  TokenRevocationTransactionStep,
  Permit2TransactionStep,
  IncreasePositionTransactionStep,
  IncreasePositionTransactionStepAsync,
  DecreasePositionTransactionStep,
  CollectFeesTransactionStep,
  UnifiedYieldApprovalStep,
  UnifiedYieldDepositStep,
  UnifiedYieldWithdrawStep,
  ZapSwapApprovalStep,
  ZapPSMSwapStep,
  ZapPoolSwapStep,
  ZapDynamicDepositStep,
  LiquidityAction,
} from '../../../types';
import { TransactionStepType } from '../../../types';

import { handleApprovalTransactionStep } from './approvalHandler';
import { handlePermitTransactionStep } from './approvalHandler';
import { handlePositionTransactionStep } from './positionHandler';
import {
  handleUnifiedYieldApprovalStep,
  handleUnifiedYieldDepositStep,
  handleUnifiedYieldWithdrawStep,
} from './unifiedYieldHandler';
import {
  handleZapSwapApprovalStep,
  handleZapPSMSwapStep,
  handleZapPoolSwapStep,
  handleZapDynamicDepositStep,
} from '../../../../liquidity/zap/execution/handlers';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Common transaction functions passed to handlers
 */
export interface TransactionFunctions {
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>;
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>;
}

/**
 * Context available during step execution
 */
export interface StepExecutionContext {
  address: `0x${string}`;
  chainId?: number;
  action?: LiquidityAction;
  signature?: string; // From prior Permit2Signature step
  setCurrentStep: (params: { step: TransactionStep; accepted: boolean }) => void;
  /** Sign typed data for Permit2 (used by zap pool swaps) */
  signTypedData?: (args: {
    domain: { name: string; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}

/**
 * Handler function signature for transaction-sending steps
 */
export type TransactionStepHandler = (
  step: TransactionStep,
  context: StepExecutionContext,
  txFunctions: TransactionFunctions,
) => Promise<`0x${string}`>;

/**
 * Registry entry for a step type
 */
export interface StepHandlerEntry {
  /** Handler function to execute the step */
  handler: TransactionStepHandler;
  /** Step types that use signature from prior step */
  requiresSignature?: boolean;
}

// =============================================================================
// HANDLER WRAPPERS
// =============================================================================

// Import position step type union from handler
import type { PositionStep } from './positionHandler';

/**
 * Helper to narrow setCurrentStep callback type.
 * This is needed because handlers expect step-specific callbacks but the registry
 * provides a generic TransactionStep callback. Since we verify the step type before
 * calling, the narrowing is safe.
 */
function narrowSetCurrentStep<T extends TransactionStep>(
  setCurrentStep: StepExecutionContext['setCurrentStep']
): (params: { step: T; accepted: boolean }) => void {
  return setCurrentStep as (params: { step: T; accepted: boolean }) => void;
}

/**
 * Wraps approval handler to match registry signature
 */
const approvalHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  const typedStep = step as TokenApprovalTransactionStep | TokenRevocationTransactionStep;
  return handleApprovalTransactionStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

/**
 * Wraps permit transaction handler to match registry signature
 */
const permitTxHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  const typedStep = step as Permit2TransactionStep;
  return handlePermitTransactionStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

/**
 * Wraps position transaction handler to match registry signature
 */
const positionHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  if (!context.action) {
    throw new Error('Position step requires action context');
  }
  const typedStep = step as PositionStep;
  return handlePositionTransactionStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
      action: context.action,
      signature: context.signature,
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

/**
 * Wraps Unified Yield approval handler to match registry signature
 */
const uyApprovalHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  const typedStep = step as UnifiedYieldApprovalStep;
  return handleUnifiedYieldApprovalStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

/**
 * Wraps Unified Yield deposit handler to match registry signature
 */
const uyDepositHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  const typedStep = step as UnifiedYieldDepositStep;
  return handleUnifiedYieldDepositStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

/**
 * Wraps Unified Yield withdraw handler to match registry signature
 */
const uyWithdrawHandler: TransactionStepHandler = async (step, context, txFunctions) => {
  const typedStep = step as UnifiedYieldWithdrawStep;
  return handleUnifiedYieldWithdrawStep(
    {
      address: context.address,
      step: typedStep,
      setCurrentStep: narrowSetCurrentStep<typeof typedStep>(context.setCurrentStep),
    },
    txFunctions.sendTransaction,
    txFunctions.waitForReceipt,
  );
};

// =============================================================================
// REGISTRY
// =============================================================================

/**
 * Registry mapping step types to their handlers.
 *
 * Note: Permit2Signature is NOT in this registry because it uses signTypedData
 * instead of sendTransaction. Handle it separately in the executor.
 *
 * Note: IncreasePositionTransactionBatched is NOT in this registry because
 * it requires ERC-5792 sendCalls, which most wallets don't support yet.
 */
export const STEP_HANDLER_REGISTRY: Partial<Record<TransactionStepType, StepHandlerEntry>> = {
  // Approval steps
  [TransactionStepType.TokenApprovalTransaction]: {
    handler: approvalHandler,
  },
  [TransactionStepType.TokenRevocationTransaction]: {
    handler: approvalHandler,
  },
  [TransactionStepType.Permit2Transaction]: {
    handler: permitTxHandler,
  },

  // Position steps
  [TransactionStepType.IncreasePositionTransaction]: {
    handler: positionHandler,
  },
  [TransactionStepType.IncreasePositionTransactionAsync]: {
    handler: positionHandler,
    requiresSignature: true,
  },
  [TransactionStepType.DecreasePositionTransaction]: {
    handler: positionHandler,
  },
  [TransactionStepType.CollectFeesTransactionStep]: {
    handler: positionHandler,
  },

  // Unified Yield steps
  [TransactionStepType.UnifiedYieldApprovalTransaction]: {
    handler: uyApprovalHandler,
  },
  [TransactionStepType.UnifiedYieldDepositTransaction]: {
    handler: uyDepositHandler,
  },
  [TransactionStepType.UnifiedYieldWithdrawTransaction]: {
    handler: uyWithdrawHandler,
  },

  // Zap steps (single-token deposit with swap)
  [TransactionStepType.ZapSwapApproval]: {
    handler: handleZapSwapApprovalStep,
  },
  [TransactionStepType.ZapPSMSwap]: {
    handler: handleZapPSMSwapStep,
  },
  [TransactionStepType.ZapPoolSwap]: {
    handler: handleZapPoolSwapStep,
  },
  [TransactionStepType.ZapDynamicDeposit]: {
    handler: handleZapDynamicDepositStep,
  },
};

/**
 * Check if a step type is handled by the registry
 */
export function isRegisteredStepType(type: TransactionStepType): boolean {
  return type in STEP_HANDLER_REGISTRY;
}

/**
 * Get handler entry for a step type
 */
export function getStepHandler(type: TransactionStepType): StepHandlerEntry | undefined {
  return STEP_HANDLER_REGISTRY[type];
}

/**
 * Execute a step using the registry
 *
 * @returns txHash on success, undefined for unhandled types
 * @throws Error if handler fails
 */
export async function executeRegisteredStep(
  step: TransactionStep,
  context: StepExecutionContext,
  txFunctions: TransactionFunctions,
): Promise<`0x${string}` | undefined> {
  const entry = STEP_HANDLER_REGISTRY[step.type];
  if (!entry) {
    return undefined;
  }
  return entry.handler(step, context, txFunctions);
}
