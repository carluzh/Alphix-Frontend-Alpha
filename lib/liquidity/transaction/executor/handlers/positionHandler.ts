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
import { reportFailedTx, markReported } from '@/lib/observability';
import { extractRevertReason } from '@/lib/liquidity/utils/extractRevertReason';
import type {
  IncreasePositionTransactionStep,
  IncreasePositionTransactionStepAsync,
  DecreasePositionTransactionStep,
  CollectFeesTransactionStep,
  LiquidityAction,
  ValidatedTransactionRequest,
} from '../../../types';
import { TransactionStepType } from '../../../types';

// =============================================================================
// TYPES - Matches Uniswap's HandlePositionStepParams
// =============================================================================

export type PositionStep =
  | IncreasePositionTransactionStep
  | IncreasePositionTransactionStepAsync
  | DecreasePositionTransactionStep
  | CollectFeesTransactionStep;

export interface HandlePositionStepParams {
  address: `0x${string}`;
  step: PositionStep;
  setCurrentStep: (params: { step: PositionStep; accepted: boolean }) => void;
  action: LiquidityAction;
  signature?: string;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
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
): Promise<{ txRequest: ValidatedTransactionRequest }> {
  if (
    step.type === TransactionStepType.IncreasePositionTransaction ||
    step.type === TransactionStepType.DecreasePositionTransaction
  ) {
    return {
      txRequest: step.txRequest,
    };
  }

  if (step.type === TransactionStepType.CollectFeesTransactionStep) {
    return { txRequest: step.txRequest };
  }

  // Async step — signature is optional. The async builder calls our backend, which
  // forwards an empty signature as `undefined` to Uniswap's API for the no-permit
  // re-fetch path (existing Permit2 state covers spending after ERC20 approves).
  //
  // H2 guard: distinguish absent (legitimate no-permit flow) from present-but-malformed
  // (silent corruption — must fail loud). A real EIP-712 sig is 0x + 130 hex = 132 chars.
  // Anything in between is a bug we want surfaced before hitting the backend.
  let effectiveSignature = '';
  if (signature !== undefined && signature !== null && signature !== '') {
    if (typeof signature !== 'string' || !signature.startsWith('0x') || signature.length < 132) {
      throw new Error(
        'Permit signature missing or malformed — refusing to submit unsigned tx ' +
          `(received length=${typeof signature === 'string' ? signature.length : 'n/a'})`,
      );
    }
    effectiveSignature = signature;
  }
  const { txRequest } = await step.getTxRequest(effectiveSignature);

  if (!txRequest) {
    throw new Error('txRequest must be defined');
  }

  return { txRequest };
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
  const { step, setCurrentStep, signature, address, chainId } = params;

  // Get the transaction request (may need to call async function for permit flows)
  const { txRequest } = await getLiquidityTxRequest(step, signature);

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit transaction with gas limit from API
  // AUDITED PATH: this call must remain a thin wrapper over wagmi.sendTransaction.
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
    // Best-effort revert reason capture (does NOT touch the audited send path).
    // The consolidated helper replays the failed call via eth_call (read-only) and
    // decodes the revert into BaseError.shortMessage, surfacing names like
    // 'PriceLimitReached', 'TickSlippage', 'PermitSignatureExpired'. This produces
    // an event identical to the prior inline withScope block — the probe was lifted
    // into the helper verbatim — while leaving the audited sendTransaction untouched.
    await reportFailedTx(null, {
      domain: 'liquidity',
      action: step.type,
      component: 'positionHandler',
      txHash: hash,
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value,
      from: address,
      chainId,
      extras: { userAddress: address },
    });

    // Re-decode for the user-facing thrown message (identical to prior behavior).
    const revertInfo = await extractRevertReason({
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value,
      from: address,
      chainId,
    });

    throw markReported(
      new Error(
        `${step.type} transaction reverted${revertInfo.shortMessage ? `: ${revertInfo.shortMessage}` : ''}`,
      ),
    );
  }

  return hash;
}

// =============================================================================
// REVERT REASON PROBE
// =============================================================================
//
// The read-only eth_call revert-decode probe now lives in the shared util
// `@/lib/liquidity/utils/extractRevertReason` (also consumed by reportFailedTx in
// lib/observability). It is read-only and never touches the audited send path. The
// thrown-message decode above (`${step.type} transaction reverted: <shortMessage>`)
// delegates to it verbatim, preserving the exact user-facing message.
