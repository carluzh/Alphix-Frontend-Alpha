/**
 * Pure core of the EIP-5792 batched-increase executor.
 *
 * Split out of `useExecutorBridge.ts` so the logic can be unit-tested
 * without rendering the React hook. The hook wires wagmi's `sendCalls` /
 * `waitForCallsStatus` into this helper.
 */

import type { Hex } from 'viem';
import type { IncreasePositionTransactionStepBatchedAsync } from '@/lib/liquidity/types';

export interface BatchedCall {
  to: `0x${string}`;
  data: Hex;
  value?: bigint;
}

export interface BatchedIncreaseDeps {
  /** EIP-712 signature from the prior Permit2Signature step. */
  signature: string;
  /** wagmi `sendCallsAsync({ calls })` — returns `{ id }`. */
  sendCalls: (args: { calls: BatchedCall[] }) => Promise<{ id: string }>;
  /** wagmi `waitForCallsStatus({ id })` — returns `{ status, receipts? }`. */
  waitForCallsStatus: (args: { id: string }) => Promise<{
    status: 'pending' | 'success' | 'failure' | undefined;
    receipts?: ReadonlyArray<{ transactionHash?: `0x${string}` }>;
  }>;
  /** Hex suffix (with or without `0x` prefix) appended to each call's data for builder attribution. */
  builderSuffix: Hex;
}

/**
 * Execute a batched-async increase step: build the mint tx via the step's
 * async `getTxRequest(signature)`, then bundle approvals + mint into one
 * `wallet_sendCalls` call and wait for confirmation. Returns the last
 * call's transaction hash, which corresponds to the mint on-chain tx.
 */
export async function executeBatchedIncrease(
  step: IncreasePositionTransactionStepBatchedAsync,
  deps: BatchedIncreaseDeps,
): Promise<{ txHash?: `0x${string}` }> {
  const { signature, sendCalls, waitForCallsStatus, builderSuffix } = deps;

  const { txRequest } = await step.getTxRequest(signature);
  if (!txRequest) throw new Error('Failed to build mint transaction request');

  const suffixHex = builderSuffix.startsWith('0x')
    ? builderSuffix.slice(2).toLowerCase()
    : builderSuffix.toLowerCase();

  const withSuffix = (data: Hex): Hex =>
    (data.toLowerCase().endsWith(suffixHex) ? data : ((data + suffixHex) as Hex));

  const calls: BatchedCall[] = [
    ...step.approvalRequests.map((r) => ({
      to: r.to,
      data: withSuffix(r.data),
      value: r.value,
    })),
    { to: txRequest.to, data: withSuffix(txRequest.data as Hex), value: txRequest.value },
  ];

  const { id } = await sendCalls({ calls });

  const { status, receipts } = await waitForCallsStatus({ id });
  if (status !== 'success') throw new Error(`Batched transaction failed (status=${status ?? 'undefined'})`);

  const lastReceipt = receipts?.[receipts.length - 1];
  return { txHash: lastReceipt?.transactionHash };
}
