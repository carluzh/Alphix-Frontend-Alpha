/**
 * Decrease Liquidity Flow Definition
 *
 * Single-step flow: just the decrease/withdraw transaction.
 * No approvals or permits needed (user is withdrawing, not depositing).
 * Supports both V4 and Unified Yield positions.
 *
 * @see ../EXECUTION_REFACTOR_BRIEF.md — Layer 3
 */

import { useCallback, useMemo } from 'react';
import { useSendTransaction } from 'wagmi';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { TransactionStepType } from '@/lib/transactions/types';
import type { TransactionStep } from '@/lib/transactions/types';
import type { StepGenerationResult, StepExecutorFn } from '@/lib/transactions/useStepExecutor';
import type { ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import { generateLPTransactionSteps } from '@/lib/liquidity/transaction';

// =============================================================================
// TYPES
// =============================================================================

export interface UseDecreaseLiquidityFlowParams {
  /** Builds the validated tx context from the API */
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  /** Token metadata for UI step mapping */
  token0Symbol: string;
  token1Symbol: string;
  token0Icon?: string;
  token1Icon?: string;
}

// =============================================================================
// HOOK
// =============================================================================

export function useDecreaseLiquidityFlow(params: UseDecreaseLiquidityFlowParams) {
  const { fetchAndBuildContext, token0Symbol, token1Symbol, token0Icon, token1Icon } = params;
  const { sendTransactionAsync } = useSendTransaction();
  const config = useConfig();

  // ─── Generate steps ──────────────────────────────────────────────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    const context = await fetchAndBuildContext();
    if (!context) throw new Error('Failed to build transaction context');

    // Generate steps from Uniswap-style context
    const liquiditySteps = generateLPTransactionSteps(context);

    // Convert to generic steps with attached tx data
    const steps = liquiditySteps.map((step) => {
      // Attach the original step data for the executor
      return { ...step, _originalStep: step };
    });

    return { steps };
  }, [fetchAndBuildContext]);

  // ─── Executors ───────────────────────────────────────────────────────────
  const executors = useMemo((): Record<string, StepExecutorFn> => ({
    // V4 decrease position
    [TransactionStepType.DecreasePositionTransaction]: async (step) => {
      const txReq = step.txRequest || step._originalStep?.txRequest;
      if (!txReq) throw new Error('Transaction request missing for decrease');

      const hash = await sendTransactionAsync({
        to: txReq.to,
        data: txReq.data,
        value: txReq.value,
        gas: txReq.gasLimit,
      });

      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status === 'reverted') {
        throw new Error('Decrease liquidity transaction reverted');
      }

      return { txHash: hash };
    },

    // Unified Yield withdraw
    UnifiedYieldWithdraw: async (step) => {
      const txReq = step.txRequest || step._originalStep?.txRequest;
      if (!txReq) throw new Error('Transaction request missing for UY withdraw');

      const hash = await sendTransactionAsync({
        to: txReq.to,
        data: txReq.data,
        value: txReq.value,
        gas: txReq.gasLimit,
      });

      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status === 'reverted') {
        throw new Error('Withdraw transaction reverted');
      }

      return { txHash: hash };
    },
  }), [sendTransactionAsync, config]);

  // ─── Map steps to UI ────────────────────────────────────────────────────
  const mapStepsToUI = useCallback((steps: unknown[]): TransactionStep[] => {
    return steps.map((step: any): TransactionStep => {
      const type = step.type === 'UnifiedYieldWithdraw'
        ? TransactionStepType.DecreasePositionTransaction
        : TransactionStepType.DecreasePositionTransaction;
      return { type, token0Symbol, token1Symbol, token0Icon, token1Icon };
    });
  }, [token0Symbol, token1Symbol, token0Icon, token1Icon]);

  return { generateSteps, executors, mapStepsToUI };
}
