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

import {
  type TransactionStep,
  type LiquidityAction,
  type ValidatedLiquidityTxContext,
  type FlowStatus,
  type StepState,
  TransactionStepType,
} from '../../types';

import { generateLPTransactionSteps } from '../steps/generateLPTransactionSteps';

import {
  handleApprovalTransactionStep,
  handlePermitTransactionStep as handlePermitTxStep,
  handleSignatureStep,
  handlePositionTransactionStep,
  handlePositionTransactionBatchedStep,
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

  const { address } = useAccount();
  const config = useConfig();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

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
    async (args: { to: `0x${string}`; data: Hex; value?: bigint }): Promise<`0x${string}`> => {
      return sendTransactionAsync({
        to: args.to,
        data: args.data,
        value: args.value,
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
          switch (step.type) {
            // COPIED FROM UNISWAP: case TransactionStepType.TokenRevocationTransaction:
            // COPIED FROM UNISWAP: case TransactionStepType.TokenApprovalTransaction:
            case TransactionStepType.TokenRevocationTransaction:
            case TransactionStepType.TokenApprovalTransaction: {
              lastTxHash = await handleApprovalTransactionStep(
                { address, step, setCurrentStep: setCurrentStep(i) },
                sendTransaction,
                waitForReceipt,
              );
              break;
            }

            // COPIED FROM UNISWAP: case TransactionStepType.Permit2Signature:
            case TransactionStepType.Permit2Signature: {
              signature = await handleSignatureStep(
                { address, step, setCurrentStep: setCurrentStep(i) },
                signTypedData,
              );
              break;
            }

            // COPIED FROM UNISWAP: case TransactionStepType.Permit2Transaction:
            case TransactionStepType.Permit2Transaction: {
              lastTxHash = await handlePermitTxStep(
                { address, step, setCurrentStep: setCurrentStep(i) },
                sendTransaction,
                waitForReceipt,
              );
              break;
            }

            // COPIED FROM UNISWAP: case TransactionStepType.IncreasePositionTransaction:
            // COPIED FROM UNISWAP: case TransactionStepType.IncreasePositionTransactionAsync:
            // COPIED FROM UNISWAP: case TransactionStepType.DecreasePositionTransaction:
            // COPIED FROM UNISWAP: case TransactionStepType.CollectFeesTransactionStep:
            case TransactionStepType.IncreasePositionTransaction:
            case TransactionStepType.IncreasePositionTransactionAsync:
            case TransactionStepType.DecreasePositionTransaction:
            case TransactionStepType.CollectFeesTransactionStep: {
              lastTxHash = await handlePositionTransactionStep(
                { address, step, setCurrentStep: setCurrentStep(i), action: txContext.action, signature },
                sendTransaction,
                waitForReceipt,
              );
              break;
            }

            // COPIED FROM UNISWAP: case TransactionStepType.IncreasePositionTransactionBatched:
            case TransactionStepType.IncreasePositionTransactionBatched: {
              // Note: ERC-5792 batched transactions require special wallet support
              // For now, we throw an error as most wallets don't support this yet
              throw new Error('Batched transactions not yet supported');
            }

            default: {
              throw new Error(`Unexpected step type: ${(step as any).type}`);
            }
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
    [address, sendTransaction, waitForReceipt, signTypedData, setCurrentStep, onSuccess, onFailure],
  );

  return {
    execute,
    state,
    reset,
  };
}
