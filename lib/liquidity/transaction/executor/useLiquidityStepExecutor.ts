/**
 * Liquidity Step Executor Hook
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 *
 * This hook executes the ordered transaction steps for liquidity operations.
 * Adapted from Redux Saga's modifyLiquidity generator to async/await with wagmi hooks.
 */

import { useCallback, useState, useRef } from 'react';
import { useAccount, useSendTransaction, useSignTypedData, useWaitForTransactionReceipt } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { useConfig } from 'wagmi';
import type { Hex } from 'viem';
import { useTransactionAdder, TransactionType, type LiquidityIncreaseTransactionInfo, type LiquidityDecreaseTransactionInfo, type ApproveTransactionInfo, type Permit2ApproveTransactionInfo } from '@/lib/transactions';

import {
  type TransactionStep,
  type LiquidityAction,
  type ValidatedLiquidityTxContext,
  type FlowStatus,
  type StepState,
  type UnifiedYieldApprovalStep,
  type UnifiedYieldDepositStep,
  type UnifiedYieldWithdrawStep,
  TransactionStepType,
} from '../../types';

import { generateLPTransactionSteps } from '../steps/generateLPTransactionSteps';

import {
  handleSignatureStep,
  // Unified Yield info getters (for transaction tracking)
  getUnifiedYieldApprovalInfo,
  getUnifiedYieldDepositInfo,
  getUnifiedYieldWithdrawInfo,
  // Registry-based execution
  executeRegisteredStep,
  isRegisteredStepType,
  type StepExecutionContext,
  type TransactionFunctions,
} from './handlers';

// =============================================================================
// TYPES
// =============================================================================

export interface UseLiquidityStepExecutorOptions {
  onSuccess?: (txHash?: string) => void;
  onFailure?: (error?: Error) => void;
  onStepChange?: (stepIndex: number, step: TransactionStep, accepted: boolean) => void;
}

export interface LiquidityExecutorState {
  steps: StepState[];
  currentStepIndex: number;
  status: FlowStatus;
  error?: string;
  isExecuting: boolean;
}

export interface UseLiquidityStepExecutorReturn {
  execute: (txContext: ValidatedLiquidityTxContext) => Promise<void>;
  state: LiquidityExecutorState;
  reset: () => void;
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const INITIAL_STATE: LiquidityExecutorState = {
  steps: [],
  currentStepIndex: 0,
  status: 'idle',
  error: undefined,
  isExecuting: false,
};

// =============================================================================
// TRANSACTION TRACKING HELPER
// =============================================================================

/**
 * Tracks a transaction in the transaction history based on step type.
 * Extracted from the switch statement to work with registry-based execution.
 */
function trackStepTransaction(
  step: TransactionStep,
  txHash: string,
  chainId: number,
  address: `0x${string}`,
  txContext: ValidatedLiquidityTxContext,
  addTransaction: ReturnType<typeof useTransactionAdder>,
): void {
  const baseTx = { hash: txHash, chainId, from: address } as any;

  switch (step.type) {
    // Approval steps
    case TransactionStepType.TokenRevocationTransaction:
    case TransactionStepType.TokenApprovalTransaction: {
      const approveInfo: ApproveTransactionInfo = {
        type: TransactionType.Approve,
        tokenAddress: (step as any).token?.address || '',
        spender: (step as any).spender || '',
      };
      addTransaction(baseTx, approveInfo);
      break;
    }

    // Permit2 transaction
    case TransactionStepType.Permit2Transaction: {
      const permit2Info: Permit2ApproveTransactionInfo = {
        type: TransactionType.Permit2Approve,
        tokenAddress: (step as any).token?.address || '',
        spender: (step as any).spender || '',
        amount: (step as any).amount || '',
      };
      addTransaction(baseTx, permit2Info);
      break;
    }

    // Position steps (V4)
    case TransactionStepType.IncreasePositionTransaction:
    case TransactionStepType.IncreasePositionTransactionAsync:
    case TransactionStepType.DecreasePositionTransaction:
    case TransactionStepType.CollectFeesTransactionStep: {
      if (txContext.action) {
        const isIncrease = step.type === TransactionStepType.IncreasePositionTransaction ||
                           step.type === TransactionStepType.IncreasePositionTransactionAsync;
        const isCollect = step.type === TransactionStepType.CollectFeesTransactionStep;
        const txType = isCollect ? TransactionType.CollectFees :
                       isIncrease ? TransactionType.LiquidityIncrease : TransactionType.LiquidityDecrease;
        const { currency0Amount, currency1Amount } = txContext.action;
        const typeInfo = {
          type: txType,
          currency0Id: currency0Amount?.currency ? `${chainId}-${currency0Amount.currency.wrapped?.address || ''}` : '',
          currency1Id: currency1Amount?.currency ? `${chainId}-${currency1Amount.currency.wrapped?.address || ''}` : '',
          currency0AmountRaw: currency0Amount?.quotient?.toString() || '0',
          currency1AmountRaw: currency1Amount?.quotient?.toString() || '0',
        };
        addTransaction(baseTx, typeInfo as any);
      }
      break;
    }

    // Unified Yield approval
    case TransactionStepType.UnifiedYieldApprovalTransaction: {
      const uyApprovalStep = step as UnifiedYieldApprovalStep;
      const approvalInfo = getUnifiedYieldApprovalInfo(uyApprovalStep);
      addTransaction(baseTx, {
        type: TransactionType.Approve,
        tokenAddress: approvalInfo.tokenAddress,
        spender: approvalInfo.hookAddress,
      } as ApproveTransactionInfo);
      break;
    }

    // Unified Yield deposit
    case TransactionStepType.UnifiedYieldDepositTransaction: {
      const uyDepositStep = step as UnifiedYieldDepositStep;
      const depositInfo = getUnifiedYieldDepositInfo(uyDepositStep);
      addTransaction(baseTx, {
        type: TransactionType.LiquidityIncrease,
        currency0Id: `${chainId}-${depositInfo.token0Symbol}`,
        currency1Id: `${chainId}-${depositInfo.token1Symbol}`,
        currency0AmountRaw: depositInfo.sharesToMint,
        currency1AmountRaw: '0',
      } as any);
      break;
    }

    // Unified Yield withdraw
    case TransactionStepType.UnifiedYieldWithdrawTransaction: {
      const uyWithdrawStep = step as UnifiedYieldWithdrawStep;
      const withdrawInfo = getUnifiedYieldWithdrawInfo(uyWithdrawStep);
      addTransaction(baseTx, {
        type: TransactionType.LiquidityDecrease,
        currency0Id: `${chainId}-${withdrawInfo.token0Symbol}`,
        currency1Id: `${chainId}-${withdrawInfo.token1Symbol}`,
        currency0AmountRaw: withdrawInfo.sharesToWithdraw,
        currency1AmountRaw: '0',
      } as any);
      break;
    }

    // No tracking needed for other types
    default:
      break;
  }
}

// =============================================================================
// EXECUTOR HOOK - ADAPTED FROM UNISWAP liquiditySaga.ts modifyLiquidity
// =============================================================================

/**
 * Hook for executing liquidity transaction steps
 *
 * ADAPTED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 * The modifyLiquidity generator function (lines 243-317) is adapted to async/await.
 *
 * @param options - Callbacks for success, failure, and step changes
 * @returns Execute function and executor state
 */
export function useLiquidityStepExecutor(
  options: UseLiquidityStepExecutorOptions = {},
): UseLiquidityStepExecutorReturn {
  const { onSuccess, onFailure, onStepChange } = options;

  const { address, chainId } = useAccount();
  const config = useConfig();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

  // Transaction tracking
  const addTransaction = useTransactionAdder();

  const [state, setState] = useState<LiquidityExecutorState>(INITIAL_STATE);

  // Use ref to track current execution to prevent stale closures
  const executionRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  /**
   * Reset executor state
   */
  const reset = useCallback(() => {
    executionRef.current.cancelled = true;
    setState(INITIAL_STATE);
  }, []);

  /**
   * Update step state
   */
  const setCurrentStep = useCallback(
    (stepIndex: number) =>
      (params: { step: TransactionStep; accepted: boolean }) => {
        setState(prev => {
          const newSteps = [...prev.steps];
          if (newSteps[stepIndex]) {
            newSteps[stepIndex] = {
              ...newSteps[stepIndex],
              status: params.accepted ? 'loading' : 'pending',
            };
          }
          return {
            ...prev,
            steps: newSteps,
            currentStepIndex: stepIndex,
          };
        });

        onStepChange?.(stepIndex, params.step, params.accepted);
      },
    [onStepChange],
  );

  /**
   * Send transaction helper using wagmi
   */
  const sendTransaction = useCallback(
    async (args: { to: `0x${string}`; data: Hex; value?: bigint; gasLimit?: bigint }): Promise<`0x${string}`> => {
      return sendTransactionAsync({
        to: args.to,
        data: args.data,
        value: args.value,
        gas: args.gasLimit, // wagmi uses 'gas' not 'gasLimit'
      });
    },
    [sendTransactionAsync],
  );

  /**
   * Wait for transaction receipt helper using wagmi
   */
  const waitForReceipt = useCallback(
    async (args: { hash: `0x${string}` }): Promise<{ status: 'success' | 'reverted' }> => {
      const receipt = await waitForTransactionReceipt(config, {
        hash: args.hash,
      });
      return { status: receipt.status };
    },
    [config],
  );

  /**
   * Sign typed data helper using wagmi
   */
  const signTypedData = useCallback(
    async (args: {
      domain: {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      };
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> => {
      return signTypedDataAsync({
        domain: args.domain,
        types: args.types,
        primaryType: args.primaryType,
        message: args.message,
      });
    },
    [signTypedDataAsync],
  );

  /**
   * Execute liquidity transaction steps
   *
   * ADAPTED FROM interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
   * modifyLiquidity function (lines 243-317)
   */
  const execute = useCallback(
    async (txContext: ValidatedLiquidityTxContext): Promise<void> => {
      if (!address) {
        onFailure?.(new Error('No wallet connected'));
        return;
      }

      // Reset cancellation flag
      executionRef.current = { cancelled: false };

      // Generate steps from context
      const steps = generateLPTransactionSteps(txContext);

      if (steps.length === 0) {
        onFailure?.(new Error('No transaction steps generated'));
        return;
      }

      // Initialize state with steps
      setState({
        steps: steps.map(step => ({
          step,
          status: 'pending' as FlowStatus,
        })),
        currentStepIndex: 0,
        status: 'loading',
        error: undefined,
        isExecuting: true,
      });

      let signature: string | undefined;
      let lastTxHash: string | undefined;

      // Execute each step in order
      // COPIED FROM UNISWAP: for (const step of steps) switch statement
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // Check if execution was cancelled
        if (executionRef.current.cancelled) {
          setState(prev => ({
            ...prev,
            status: 'idle',
            isExecuting: false,
          }));
          return;
        }

        try {
          // =============================================================================
          // SPECIAL CASES - Not handled by registry
          // =============================================================================

          // Permit2Signature: Uses signTypedData instead of sendTransaction
          if (step.type === TransactionStepType.Permit2Signature) {
            // C3: Extract token info for permit caching
            const token0Symbol = txContext.action?.currency0Amount?.currency?.symbol;
            const token1Symbol = txContext.action?.currency1Amount?.currency?.symbol;

            signature = await handleSignatureStep(
              {
                address,
                step,
                setCurrentStep: setCurrentStep(i),
                chainId,
                token0Symbol,
                token1Symbol,
              },
              signTypedData,
            );
          }
          // IncreasePositionTransactionBatched: Requires ERC-5792 (unsupported)
          else if (step.type === TransactionStepType.IncreasePositionTransactionBatched) {
            throw new Error('Batched transactions not yet supported');
          }
          // =============================================================================
          // REGISTRY-BASED EXECUTION - All other step types
          // =============================================================================
          else if (isRegisteredStepType(step.type)) {
            // Build execution context
            const context: StepExecutionContext = {
              address,
              chainId,
              action: txContext.action,
              signature,
              setCurrentStep: setCurrentStep(i),
              signTypedData, // Pass for handlers that need Permit2 signing (e.g., zap pool swap)
            };

            // Build transaction functions
            const txFunctions: TransactionFunctions = {
              sendTransaction,
              waitForReceipt,
            };

            // Execute via registry
            const txHash = await executeRegisteredStep(step, context, txFunctions);
            if (txHash) {
              lastTxHash = txHash;

              // Track transaction based on step type
              if (chainId) {
                trackStepTransaction(step, txHash, chainId, address, txContext, addTransaction);
              }
            }
          }
          // Unknown step type
          else {
            throw new Error(`Unexpected step type: ${(step as any).type}`);
          }

          // Mark step as completed
          setState(prev => {
            const newSteps = [...prev.steps];
            if (newSteps[i]) {
              newSteps[i] = {
                ...newSteps[i],
                status: 'completed',
                txHash: lastTxHash as Hex | undefined,
                signature: step.type === TransactionStepType.Permit2Signature ? signature : undefined,
              };
            }
            return {
              ...prev,
              steps: newSteps,
            };
          });
        } catch (error) {
          // Mark step as errored
          setState(prev => {
            const newSteps = [...prev.steps];
            if (newSteps[i]) {
              newSteps[i] = {
                ...newSteps[i],
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
              };
            }
            return {
              ...prev,
              steps: newSteps,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
              isExecuting: false,
            };
          });

          onFailure?.(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }

      // All steps completed successfully
      setState(prev => ({
        ...prev,
        status: 'completed',
        isExecuting: false,
      }));

      onSuccess?.(lastTxHash);
    },
    [address, chainId, sendTransaction, waitForReceipt, signTypedData, setCurrentStep, onSuccess, onFailure, addTransaction],
  );

  return {
    execute,
    state,
    reset,
  };
}
