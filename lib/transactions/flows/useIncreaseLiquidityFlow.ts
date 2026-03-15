/**
 * Increase Liquidity Flow Definition
 *
 * Multi-step flow: approvals → permit → increase position.
 * Supports both V4 (Permit2) and Unified Yield (direct ERC20 approval) paths.
 *
 * @see ../EXECUTION_REFACTOR_BRIEF.md — Layer 3
 */

import { useCallback, useMemo } from 'react';
import { useSendTransaction, useSignTypedData } from 'wagmi';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { TransactionStepType as UIStepType } from '@/lib/transactions/types';
import type { TransactionStep as UITransactionStep } from '@/lib/transactions/types';
import type { StepGenerationResult, StepExecutorFn } from '@/lib/transactions/useStepExecutor';
import type { ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import { TransactionStepType } from '@/lib/liquidity/types/transaction';
import { generateLPTransactionSteps } from '@/lib/liquidity/transaction';

// =============================================================================
// TYPES
// =============================================================================

export interface UseIncreaseLiquidityFlowParams {
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  token0Symbol: string;
  token1Symbol: string;
  token0Icon?: string;
  token1Icon?: string;
}

// =============================================================================
// HOOK
// =============================================================================

export function useIncreaseLiquidityFlow(params: UseIncreaseLiquidityFlowParams) {
  const { fetchAndBuildContext, token0Symbol, token1Symbol, token0Icon, token1Icon } = params;
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const config = useConfig();

  // ─── Generate steps ──────────────────────────────────────────────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    const context = await fetchAndBuildContext();
    if (!context) throw new Error('Failed to build transaction context');

    const liquiditySteps = generateLPTransactionSteps(context);
    return { steps: liquiditySteps };
  }, [fetchAndBuildContext]);

  // ─── Send + confirm helper ──────────────────────────────────────────────
  const sendAndConfirm = useCallback(async (step: any): Promise<string> => {
    const txReq = step.txRequest;
    if (!txReq) throw new Error('Transaction request missing');

    const hash = await sendTransactionAsync({
      to: txReq.to,
      data: txReq.data,
      value: txReq.value,
      gas: txReq.gasLimit,
    });

    const receipt = await waitForTransactionReceipt(config, { hash });
    if (receipt.status === 'reverted') {
      throw new Error(`Transaction reverted (${step.type})`);
    }

    return hash;
  }, [sendTransactionAsync, config]);

  // ─── Executors ───────────────────────────────────────────────────────────
  const executors = useMemo((): Record<string, StepExecutorFn> => ({
    // V4 token approval (ERC20 → Permit2)
    [TransactionStepType.TokenApprovalTransaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },

    // Token revocation
    [TransactionStepType.TokenRevocationTransaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },

    // Permit2 signature (gasless signing)
    [TransactionStepType.Permit2Signature]: async (step) => {
      const primaryType = Object.keys(step.types).find(
        (key: string) => key !== 'EIP712Domain'
      ) || 'PermitBatch';

      const signature = await signTypedDataAsync({
        domain: step.domain,
        types: step.types,
        primaryType,
        message: step.values,
      });

      return { signature };
    },

    // Permit2 transaction (on-chain permit)
    [TransactionStepType.Permit2Transaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },

    // V4 increase position (pre-built tx)
    [TransactionStepType.IncreasePositionTransaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },

    // V4 increase position async (needs signature to build tx)
    [TransactionStepType.IncreasePositionTransactionAsync]: async (step, context) => {
      const signature = context.signature;
      if (!signature) throw new Error('Signature required for async increase position');

      const { txRequest } = await step.getTxRequest(signature);
      if (!txRequest) throw new Error('Failed to build transaction request');

      const hash = await sendTransactionAsync({
        to: txRequest.to,
        data: txRequest.data,
        value: txRequest.value,
        gas: txRequest.gasLimit,
      });

      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status === 'reverted') {
        throw new Error('Increase position transaction reverted');
      }

      return { txHash: hash };
    },

    // Unified Yield approval (ERC20 → Hook)
    [TransactionStepType.UnifiedYieldApprovalTransaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },

    // Unified Yield deposit
    [TransactionStepType.UnifiedYieldDepositTransaction]: async (step) => {
      const hash = await sendAndConfirm(step);
      return { txHash: hash };
    },
  }), [sendAndConfirm, signTypedDataAsync, sendTransactionAsync, config]);

  // ─── Map steps to UI ────────────────────────────────────────────────────
  const mapStepsToUI = useCallback((steps: unknown[]): UITransactionStep[] => {
    return (steps as any[]).map((step): UITransactionStep => {
      switch (step.type) {
        case TransactionStepType.TokenApprovalTransaction:
        case TransactionStepType.TokenRevocationTransaction:
        case TransactionStepType.UnifiedYieldApprovalTransaction: {
          const tokenSymbol = step.token?.symbol || step.tokenSymbol || token0Symbol;
          const tokenAddress = step.token?.address || step.tokenAddress || '';
          const isToken0 = tokenSymbol === token0Symbol;
          return {
            type: UIStepType.TokenApprovalTransaction,
            tokenSymbol,
            tokenAddress,
            tokenIcon: isToken0 ? token0Icon : token1Icon,
          };
        }
        case TransactionStepType.Permit2Signature:
          return { type: UIStepType.Permit2Signature };
        case TransactionStepType.IncreasePositionTransaction:
        case TransactionStepType.IncreasePositionTransactionAsync:
        case TransactionStepType.UnifiedYieldDepositTransaction:
          return {
            type: UIStepType.IncreasePositionTransaction,
            token0Symbol,
            token1Symbol,
            token0Icon,
            token1Icon,
          };
        default:
          return {
            type: UIStepType.IncreasePositionTransaction,
            token0Symbol,
            token1Symbol,
            token0Icon,
            token1Icon,
          };
      }
    });
  }, [token0Symbol, token1Symbol, token0Icon, token1Icon]);

  return { generateSteps, executors, mapStepsToUI };
}
