/**
 * Collect Fees Flow Definition
 *
 * Simplest flow: single step, no approvals, no permits.
 * Calls API to get tx data, then sends and confirms.
 *
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 3
 */

import { useCallback, useMemo } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import type { Hex, Address } from 'viem';

import { useNetwork } from '@/lib/network-context';
import { chainIdForMode, type NetworkMode } from '@/lib/network-mode';
import { TransactionStepType } from '@/lib/transactions/types';
import type { StepGenerationResult, StepExecutorFn } from '@/lib/transactions/useStepExecutor';
import type { TransactionStep } from '@/lib/transactions/types';

// =============================================================================
// TYPES
// =============================================================================

export interface UseCollectFeesFlowParams {
  positionId: string;
  networkMode: NetworkMode | undefined;
  token0Symbol: string;
  token1Symbol: string;
  token0Icon?: string;
  token1Icon?: string;
}

// =============================================================================
// HOOK
// =============================================================================

export function useCollectFeesFlow(params: UseCollectFeesFlowParams) {
  const { positionId, networkMode, token0Symbol, token1Symbol, token0Icon, token1Icon } = params;
  const { address } = useAccount();
  const { ensureChain } = useNetwork();
  const { sendTransactionAsync } = useSendTransaction();
  const config = useConfig();

  const chainId = networkMode ? chainIdForMode(networkMode) : undefined;

  // ─── Generate steps ──────────────────────────────────────────────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected or chain not configured');
    }

    // Ensure correct chain
    const ok = await ensureChain(chainId);
    if (!ok) throw new Error('Chain switch rejected');

    // Call API to prepare collect transaction
    const response = await fetch('/api/liquidity/prepare-collect-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address,
        tokenId: positionId,
        chainId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to prepare collect transaction');
    }

    const txData = await response.json();

    // Single step: collect fees
    const step = {
      type: TransactionStepType.CollectFeesTransactionStep,
      token0Symbol,
      token1Symbol,
      token0Icon,
      token1Icon,
      // Attach tx data for the executor
      _txRequest: {
        to: txData.to as Address,
        data: txData.data as Hex,
        value: txData.value ? BigInt(txData.value) : 0n,
        gasLimit: txData.gasLimit ? BigInt(txData.gasLimit) : undefined,
      },
    };

    return { steps: [step] };
  }, [address, chainId, ensureChain, positionId, token0Symbol, token1Symbol, token0Icon, token1Icon]);

  // ─── Executors ───────────────────────────────────────────────────────────
  const executors = useMemo((): Record<string, StepExecutorFn> => ({
    [TransactionStepType.CollectFeesTransactionStep]: async (step) => {
      const txReq = step._txRequest;
      if (!txReq) throw new Error('Transaction request missing');

      const hash = await sendTransactionAsync({
        to: txReq.to,
        data: txReq.data,
        value: txReq.value,
        gas: txReq.gasLimit,
      });

      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status === 'reverted') {
        throw new Error('Collect fees transaction reverted');
      }

      return { txHash: hash };
    },
  }), [sendTransactionAsync, config]);

  // ─── Map steps to UI ────────────────────────────────────────────────────
  const mapStepsToUI = useCallback((steps: unknown[]): TransactionStep[] => {
    return steps.map((): TransactionStep => ({
      type: TransactionStepType.CollectFeesTransactionStep,
      token0Symbol,
      token1Symbol,
      token0Icon,
      token1Icon,
    }));
  }, [token0Symbol, token1Symbol, token0Icon, token1Icon]);

  return { generateSteps, executors, mapStepsToUI };
}
