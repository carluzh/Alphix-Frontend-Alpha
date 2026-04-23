/**
 * Collapse sequential approve+(permit?)+(sync|async) increase steps into an
 * EIP-5792 atomic batch (`wallet_sendCalls`). Mirrors Uniswap interface's
 * `liquiditySaga.handleAtomicSendCalls` behavior: assembles
 * `[approve_tx..., increase_tx]` into one call array regardless of whether
 * the increase tx came from a sync `txRequest` or an async `getTxRequest`.
 *
 * Three patterns folded:
 *
 *  A. Unsigned permit flow (fresh wallet, sig embedded in mint calldata):
 *       [TokenApproval?, TokenApproval?, Permit2Signature, IncreasePositionAsync]
 *       → [Permit2Signature, IncreasePositionTransactionBatchedAsync]
 *     User: 1 sig prompt + 1 sendCalls prompt = 2 wallet interactions.
 *
 *  B. No-permit re-fetch flow (existing user, valid Permit2 state, async tx):
 *       [TokenApproval?, TokenApproval?, IncreasePositionAsync]
 *       → [IncreasePositionTransactionBatchedAsync]
 *     User: 1 sendCalls prompt total.
 *
 *  C. No-permit pre-built flow (existing user, backend pre-fetched tx via
 *     `/lp/increase` simulate-without-sim retry):
 *       [TokenApproval?, TokenApproval?, IncreasePositionTransaction]
 *       → [IncreasePositionTransactionBatchedAsync (with sync tx wrapped)]
 *     User: 1 sendCalls prompt total.
 *
 * The upstream Uniswap generator emits `IncreasePositionTransactionBatched`
 * (sync) when `canBatchTransactions` is set. We use a single
 * `IncreasePositionTransactionBatchedAsync` step type for all three patterns
 * here so one executor (`executeBatchedIncrease`) handles them all.
 */

import { TransactionStepType } from '../../types';
import type {
  TransactionStep,
  TokenApprovalTransactionStep,
  Permit2SignatureStep,
  IncreasePositionTransactionStep,
  IncreasePositionTransactionStepAsync,
  IncreasePositionTransactionStepBatchedAsync,
  ValidatedTransactionRequest,
} from '../../types';

export function collapseToBatchedAsync(steps: TransactionStep[]): TransactionStep[] {
  if (!canCollapse(steps)) return steps;

  const approvals: TokenApprovalTransactionStep[] = [];
  let permitStep: Permit2SignatureStep | undefined;
  let asyncStep: IncreasePositionTransactionStepAsync | undefined;
  let syncStep: IncreasePositionTransactionStep | undefined;

  for (const step of steps) {
    switch (step.type) {
      case TransactionStepType.TokenApprovalTransaction:
        approvals.push(step as TokenApprovalTransactionStep);
        break;
      case TransactionStepType.Permit2Signature:
        permitStep = step as Permit2SignatureStep;
        break;
      case TransactionStepType.IncreasePositionTransactionAsync:
        asyncStep = step as IncreasePositionTransactionStepAsync;
        break;
      case TransactionStepType.IncreasePositionTransaction:
        syncStep = step as IncreasePositionTransactionStep;
        break;
      default:
        // Any unexpected step type disqualifies collapse.
        return steps;
    }
  }

  // Need either an async or a sync mint step.
  if (!asyncStep && !syncStep) return steps;

  const approvalRequests: ValidatedTransactionRequest[] = approvals
    .map((s) => s.txRequest)
    .filter((r): r is ValidatedTransactionRequest => Boolean(r));

  // Pick the increase tx source: async if present (signature flow), else
  // wrap the sync pre-built tx in a getTxRequest-shaped function.
  const getTxRequest: IncreasePositionTransactionStepBatchedAsync['getTxRequest'] = asyncStep
    ? asyncStep.getTxRequest
    : async () => ({
        txRequest: syncStep!.txRequest,
        sqrtRatioX96: syncStep!.sqrtRatioX96,
      });

  const batched: IncreasePositionTransactionStepBatchedAsync = {
    type: TransactionStepType.IncreasePositionTransactionBatchedAsync,
    approvalRequests,
    getTxRequest,
  };

  // Sig is a separate wallet method (signTypedData), so it stays as its own
  // prompt before the bundle. Otherwise just the bundle.
  return permitStep ? [permitStep, batched] : [batched];
}

function canCollapse(steps: TransactionStep[]): boolean {
  if (steps.length < 2) return false;
  const hasMint = steps.some(
    (s) =>
      s.type === TransactionStepType.IncreasePositionTransactionAsync ||
      s.type === TransactionStepType.IncreasePositionTransaction,
  );
  if (!hasMint) return false;
  // Require at least one approval to actually save a prompt.
  return steps.some((s) => s.type === TransactionStepType.TokenApprovalTransaction);
}
