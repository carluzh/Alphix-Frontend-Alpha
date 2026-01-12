/**
 * Position Transaction Handler
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 *
 * Handles increase, decrease, and collect fees position transactions.
 * Adapted from Redux Saga to async/await with wagmi hooks.
 */

import type { Hex } from 'viem';
import type {
  IncreasePositionTransactionStep,
  IncreasePositionTransactionStepAsync,
  IncreasePositionTransactionStepBatched,
  DecreasePositionTransactionStep,
  CollectFeesTransactionStep,
  LiquidityAction,
  ValidatedTransactionRequest,
} from '../../../types';
import { TransactionStepType, LiquidityTransactionType } from '../../../types';

// =============================================================================
// TYPES - Matches Uniswap's HandlePositionStepParams
// =============================================================================

export type PositionStep =
  | IncreasePositionTransactionStep
  | IncreasePositionTransactionStepAsync
  | DecreasePositionTransactionStep
  | CollectFeesTransactionStep;

export type BatchedPositionStep = IncreasePositionTransactionStepBatched;

export interface HandlePositionStepParams {
  address: `0x${string}`;
  step: PositionStep;
  setCurrentStep: (params: { step: PositionStep; accepted: boolean }) => void;
  action: LiquidityAction;
  signature?: string;
}

export interface HandleBatchedPositionStepParams {
  address: `0x${string}`;
  step: BatchedPositionStep;
  setCurrentStep: (params: { step: BatchedPositionStep; accepted: boolean }) => void;
  action: LiquidityAction;
}

// =============================================================================
// LIQUIDITY TRANSACTION INFO - COPIED FROM UNISWAP liquiditySaga.ts
// =============================================================================

export interface LiquidityIncreaseTransactionInfo {
  type: 'AddLiquidity';
  token0CurrencyId: string;
  token1CurrencyId: string;
}

export interface LiquidityDecreaseTransactionInfo {
  type: 'RemoveLiquidity';
  token0CurrencyId: string;
  token1CurrencyId: string;
}

export interface CollectFeesTransactionInfo {
  type: 'CollectFees';
  token0CurrencyId: string;
  token1CurrencyId: string;
}

export type LiquidityTransactionInfo =
  | LiquidityIncreaseTransactionInfo
  | LiquidityDecreaseTransactionInfo
  | CollectFeesTransactionInfo;

/**
 * Gets liquidity transaction info from action
 * ADAPTED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 */
export function getLiquidityTransactionInfo(action: LiquidityAction): LiquidityTransactionInfo {
  // Use wrapped to get the token address (handles native currency case)
  const token0CurrencyId = action.currency0Amount.currency.isNative
    ? 'ETH'
    : action.currency0Amount.currency.wrapped.address;
  const token1CurrencyId = action.currency1Amount.currency.isNative
    ? 'ETH'
    : action.currency1Amount.currency.wrapped.address;

  switch (action.type) {
    case LiquidityTransactionType.Create:
    case LiquidityTransactionType.Increase:
      return {
        type: 'AddLiquidity',
        token0CurrencyId,
        token1CurrencyId,
      };
    case LiquidityTransactionType.Decrease:
      return {
        type: 'RemoveLiquidity',
        token0CurrencyId,
        token1CurrencyId,
      };
    case LiquidityTransactionType.Collect:
      return {
        type: 'CollectFees',
        token0CurrencyId,
        token1CurrencyId,
      };
    default:
      return {
        type: 'AddLiquidity',
        token0CurrencyId,
        token1CurrencyId,
      };
  }
}

// =============================================================================
// GET TX REQUEST - COPIED FROM UNISWAP liquiditySaga.ts lines 71-105
// =============================================================================

/**
 * Gets the transaction request from a position step
 * For async steps, this calls the getTxRequest function with the signature
 *
 * COPIED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 */
export async function getLiquidityTxRequest(
  step: PositionStep,
  signature: string | undefined,
): Promise<{ txRequest: ValidatedTransactionRequest; sqrtRatioX96?: string }> {
  if (
    step.type === TransactionStepType.IncreasePositionTransaction ||
    step.type === TransactionStepType.DecreasePositionTransaction
  ) {
    return {
      txRequest: step.txRequest,
      sqrtRatioX96: step.sqrtRatioX96,
    };
  }

  if (step.type === TransactionStepType.CollectFeesTransactionStep) {
    return { txRequest: step.txRequest };
  }

  // Async step - requires signature
  if (!signature) {
    throw new Error('Signature required for async increase position transaction step');
  }

  const { txRequest, sqrtRatioX96 } = await step.getTxRequest(signature);

  if (!txRequest) {
    throw new Error('txRequest must be defined');
  }

  return { txRequest, sqrtRatioX96 };
}

// =============================================================================
// POSITION HANDLER - ADAPTED FROM UNISWAP liquiditySaga.ts lines 123-199
// =============================================================================

/**
 * Handles position transaction step (increase, decrease, collect)
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 * Original uses Redux Saga yield* call pattern, adapted to async/await
 *
 * @param params - Handler parameters including address, step, action, and callbacks
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handlePositionTransactionStep(
  params: HandlePositionStepParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep, signature } = params;

  // Get the transaction request (may need to call async function for permit flows)
  const { txRequest } = await getLiquidityTxRequest(step, signature);

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit transaction with gas limit from API
  const hash = await sendTransaction({
    to: txRequest.to,
    data: txRequest.data,
    value: txRequest.value,
    gasLimit: txRequest.gasLimit,
  });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation (Uniswap sets shouldWaitForConfirmation: false for position txs,
  // but we wait for safety in our implementation)
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    throw new Error(`${step.type} transaction reverted`);
  }

  return hash;
}

// =============================================================================
// BATCHED POSITION HANDLER - ADAPTED FROM UNISWAP liquiditySaga.ts
// =============================================================================

/**
 * Handles batched position transaction step (ERC-5792)
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 *
 * @param params - Handler parameters including address, step, action, and callbacks
 * @param sendCalls - ERC-5792 sendCalls function (wallet_sendCalls)
 * @param waitForCallsStatus - ERC-5792 getCallsStatus function
 * @returns Batch ID on success
 */
export async function handlePositionTransactionBatchedStep(
  params: HandleBatchedPositionStepParams,
  sendCalls: (args: {
    calls: Array<{
      to: `0x${string}`;
      data: Hex;
      value?: bigint;
    }>;
  }) => Promise<string>,
  waitForCallsStatus: (args: { id: string }) => Promise<{ status: 'CONFIRMED' | 'PENDING' }>,
): Promise<string> {
  const { step, setCurrentStep } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Prepare calls for batch
  const calls = step.batchedTxRequests.map(txRequest => ({
    to: txRequest.to,
    data: txRequest.data,
    value: txRequest.value,
  }));

  // Submit batched transaction via ERC-5792
  const batchId = await sendCalls({ calls });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  let status = await waitForCallsStatus({ id: batchId });
  while (status.status === 'PENDING') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    status = await waitForCallsStatus({ id: batchId });
  }

  if (status.status !== 'CONFIRMED') {
    throw new Error('Batched transaction failed');
  }

  return batchId;
}
