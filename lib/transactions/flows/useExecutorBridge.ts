/**
 * Executor Bridge — Shared factory for domain-specific executor hooks
 *
 * Bridges the handler registry to the StepExecutorFn interface.
 * Each domain hook (swap, liquidity) uses this factory with its own
 * set of step types.
 *
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 2/3
 */

import { useCallback, useMemo, type RefObject } from 'react';
import { useAccount, useSendTransaction, useSignTypedData } from 'wagmi';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import type { Hex } from 'viem';
import { BUILDER_CODE_SUFFIX } from '@/lib/builder-code';

import type { StepExecutorFn } from '@/lib/transactions/useStepExecutor';
import { TransactionStepType, type ValidatedLiquidityTxContext } from '@/lib/liquidity/types';
import {
  executeRegisteredStep,
  handleSignatureStep,
  isRegisteredStepType,
  type TransactionFunctions,
  type StepExecutionContext as RegistryStepContext,
} from '@/lib/liquidity/transaction/executor/handlers';

// =============================================================================
// DOMAIN STEP TYPE CONSTANTS
// =============================================================================

/**
 * Swap domain — steps that perform token swaps.
 * Used by: main swap flow (via useSwapFlow), zap swap portion.
 */
export const SWAP_DOMAIN_STEPS: TransactionStepType[] = [
  // Shared primitives (also in liquidity domain)
  TransactionStepType.TokenApprovalTransaction,
  TransactionStepType.Permit2Signature,
  // Zap swap-specific
  TransactionStepType.ZapSwapApproval,
  TransactionStepType.ZapPSMSwap,
  TransactionStepType.ZapPoolSwap,
];

/**
 * Liquidity domain — steps that touch positions (create, increase, decrease,
 * collect, UY deposit/withdraw, zap deposit).
 * Used by: all liquidity flows, zap deposit portion.
 */
export const LIQUIDITY_DOMAIN_STEPS: TransactionStepType[] = [
  // Shared primitives (also in swap domain)
  TransactionStepType.TokenApprovalTransaction,
  TransactionStepType.TokenRevocationTransaction,
  TransactionStepType.Permit2Signature,
  TransactionStepType.Permit2Transaction,
  // Position steps
  TransactionStepType.IncreasePositionTransaction,
  TransactionStepType.IncreasePositionTransactionAsync,
  TransactionStepType.DecreasePositionTransaction,
  TransactionStepType.CollectFeesTransactionStep,
  // Unified Yield steps
  TransactionStepType.UnifiedYieldApprovalTransaction,
  TransactionStepType.UnifiedYieldDepositTransaction,
  TransactionStepType.UnifiedYieldWithdrawTransaction,
  // Zap deposit (liquidity domain portion of zap)
  TransactionStepType.ZapDynamicDeposit,
];

/**
 * All step types — union of both domains.
 * Used by: zap flows that compose swap + liquidity steps.
 */
export const ALL_DOMAIN_STEPS: TransactionStepType[] = [
  ...new Set([...SWAP_DOMAIN_STEPS, ...LIQUIDITY_DOMAIN_STEPS]),
];

// =============================================================================
// BRIDGE FACTORY
// =============================================================================

/**
 * Creates a Record<string, StepExecutorFn> for the given step types,
 * bridging each to the handler registry.
 *
 * @param txContextRef - Ref to ValidatedLiquidityTxContext (set before execute)
 * @param stepTypes - Which step types this executor set covers
 */
export function useExecutorBridge(
  txContextRef: RefObject<ValidatedLiquidityTxContext | null>,
  stepTypes: TransactionStepType[],
): Record<string, StepExecutorFn> {
  const { address, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const config = useConfig();

  const sendTransaction = useCallback(
    async (args: { to: `0x${string}`; data: Hex; value?: bigint; gasLimit?: bigint }) => {
      return sendTransactionAsync({
        to: args.to,
        data: args.data,
        value: args.value,
        gas: args.gasLimit,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    },
    [sendTransactionAsync],
  );

  const waitForReceipt = useCallback(
    async (args: { hash: `0x${string}` }) => {
      const receipt = await waitForTransactionReceipt(config, { hash: args.hash });
      return { status: receipt.status };
    },
    [config],
  );

  const signTypedData = useCallback(
    async (args: {
      domain: { name: string; chainId: number; verifyingContract: `0x${string}` };
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => {
      return signTypedDataAsync(args);
    },
    [signTypedDataAsync],
  );

  const executors = useMemo((): Record<string, StepExecutorFn> => {
    if (!address) return {};

    const txFunctions: TransactionFunctions = { sendTransaction, waitForReceipt };

    // Generic bridge: wraps any registry handler to StepExecutorFn
    const bridgeHandler: StepExecutorFn = async (step, context) => {
      const ctx = txContextRef.current;
      const effectiveChainId = (ctx as any)?.chainId || chainId;

      const registryCtx: RegistryStepContext = {
        address,
        chainId: effectiveChainId,
        action: ctx?.action,
        signature: context.signature,
        setCurrentStep: () => {},
        signTypedData,
      };

      const txHash = await executeRegisteredStep(step, registryCtx, txFunctions);
      return { txHash: txHash || undefined };
    };

    // Permit2Signature — special case (signing, not transaction)
    const permit2SignatureExecutor: StepExecutorFn = async (step) => {
      const ctx = txContextRef.current;
      const token0Symbol = ctx?.action?.currency0Amount?.currency?.symbol;
      const token1Symbol = ctx?.action?.currency1Amount?.currency?.symbol;

      const signature = await handleSignatureStep(
        {
          address,
          step,
          setCurrentStep: () => {},
          chainId,
          token0Symbol,
          token1Symbol,
        },
        signTypedData,
      );

      return { signature };
    };

    // Build map for specified step types only
    const result: Record<string, StepExecutorFn> = {};

    for (const type of stepTypes) {
      if (type === TransactionStepType.Permit2Signature) {
        result[type] = permit2SignatureExecutor;
      } else if (isRegisteredStepType(type)) {
        result[type] = bridgeHandler;
      }
    }

    return result;
  }, [address, chainId, sendTransaction, waitForReceipt, signTypedData, txContextRef, stepTypes]);

  return executors;
}
