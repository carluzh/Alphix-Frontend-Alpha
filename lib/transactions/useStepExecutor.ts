/**
 * Generic Step Orchestrator — useStepExecutor
 *
 * Unified hook that runs any sequence of transaction steps.
 * Replaces both useLiquidityStepExecutor and useSwapStepExecutor.
 *
 * - Uses executionStore (Zustand) for lock-protected state
 * - Registry-based dispatch: executors map keyed by step type string
 * - Supports pre-completed step skipping (generalized from swap executor)
 * - Centralized error classification (user rejection vs real errors)
 * - Signature/data forwarding between steps via shared context
 * - Cancellation via ref + lock validation
 *
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 2
 */

import { useCallback, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';

import { useExecutionStore } from '@/lib/liquidity/transaction/executor/executionStore';
import type { ExecutionState } from '@/lib/liquidity/transaction/executor/executionStore';
import { isUserRejectionError, extractErrorMessage, categorizeError } from '@/lib/liquidity/utils/validation/errorHandling';
import type { FlowStatus, StepState } from '@/lib/liquidity/types/transaction';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result returned by each step executor function.
 * Signature is forwarded to subsequent steps via StepExecutionContext.
 */
export interface StepResult {
  /** Transaction hash (for on-chain steps) */
  txHash?: string;
  /** Signature (for signing steps like Permit2) */
  signature?: string;
  /** Arbitrary data to forward to subsequent steps */
  data?: Record<string, unknown>;
}

/**
 * Context passed to each executor function.
 * Accumulates results from prior steps (signatures, tx hashes, arbitrary data).
 */
export interface StepExecutionContext {
  /** Index of the current step */
  stepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Signature from a prior signing step (e.g., Permit2) */
  signature?: string;
  /** All prior step results (indexed by step index) */
  priorResults: Map<number, StepResult>;
  /** Check if execution has been cancelled */
  isCancelled: () => boolean;
}

/**
 * Executor function signature.
 * Each flow defines these for its step types.
 *
 * The `step` parameter is typed as `any` because step types vary across
 * flows (lib/transactions/types.ts vs lib/liquidity/types/transaction.ts).
 * Flow definitions provide type-safe wrappers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StepExecutorFn = (step: any, context: StepExecutionContext) => Promise<StepResult>;

/**
 * Configuration for the step orchestrator.
 */
export interface UseStepExecutorConfig {
  /** Map of step type string → executor function */
  executors: Record<string, StepExecutorFn>;
  /** Called when all steps complete successfully */
  onComplete?: (results: Map<number, StepResult>) => void;
  /** Called on step failure (after store update) */
  onFailure?: (error: Error, stepIndex: number, isRejection: boolean) => void;
  /** Called after each step completes */
  onStepComplete?: (stepIndex: number, result: StepResult) => void;
}

/**
 * Result of step generation (provided by flow definitions).
 */
export interface StepGenerationResult {
  /** Ordered steps to execute */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: any[];
  /** Indices of steps that are already completed (e.g., existing approvals) */
  preCompleted?: Set<number>;
}

/**
 * Return type of useStepExecutor.
 */
export interface UseStepExecutorReturn {
  /** Execute a set of steps */
  execute: (stepsResult: StepGenerationResult) => Promise<void>;
  /** Reset execution state (only works when not locked) */
  reset: () => void;
  /** Cancel in-flight execution */
  cancel: () => void;
  /** Current execution state from the store */
  state: ExecutionState;
  /** Current step state (convenience selector) */
  currentStep: StepState | null;
  /** Whether execution is active */
  isExecuting: boolean;
}

// =============================================================================
// HOOK
// =============================================================================

export function useStepExecutor(config: UseStepExecutorConfig): UseStepExecutorReturn {
  const { executors, onComplete, onFailure, onStepComplete } = config;

  // Execution store (Zustand)
  const store = useExecutionStore();

  // Ref for cancellation and lock ownership
  const executionRef = useRef<{
    cancelled: boolean;
    lockId: string | null;
  }>({ cancelled: false, lockId: null });

  // ───────────────────────────────────────────────────────────────────────────
  // EXECUTE
  // ───────────────────────────────────────────────────────────────────────────

  const execute = useCallback(async (stepsResult: StepGenerationResult) => {
    const { steps, preCompleted } = stepsResult;

    if (steps.length === 0) {
      onComplete?.(new Map());
      return;
    }

    // Reset cancellation flag
    executionRef.current.cancelled = false;

    // Acquire execution lock
    const lockId = store.startExecution(steps);
    executionRef.current.lockId = lockId;

    // Mark pre-completed steps in the store
    if (preCompleted) {
      for (const idx of preCompleted) {
        store.completeStep(lockId, idx);
      }
    }

    // Accumulate results from each step
    const results = new Map<number, StepResult>();
    let lastSignature: string | undefined;

    // ─── Step loop ─────────────────────────────────────────────────────────
    for (let i = 0; i < steps.length; i++) {
      // Check cancellation
      if (executionRef.current.cancelled) {
        store.cancelExecution(lockId);
        executionRef.current.lockId = null;
        return;
      }

      // Skip pre-completed steps
      if (preCompleted?.has(i)) {
        continue;
      }

      const step = steps[i];
      const stepType = step.type as string;

      // Find executor for this step type
      const executor = executors[stepType];
      if (!executor) {
        const error = new Error(`No executor registered for step type: ${stepType}`);
        Sentry.captureException(error, {
          tags: { component: 'useStepExecutor' },
          extra: { stepType, stepIndex: i, registeredTypes: Object.keys(executors) },
        });
        store.failStep(lockId, i, error.message);
        executionRef.current.lockId = null;
        onFailure?.(error, i, false);
        return;
      }

      // Mark step as active
      store.updateStep(lockId, i, { status: 'loading' as FlowStatus });

      // Build context for this step
      const context: StepExecutionContext = {
        stepIndex: i,
        totalSteps: steps.length,
        signature: lastSignature,
        priorResults: results,
        isCancelled: () => executionRef.current.cancelled,
      };

      try {
        const result = await executor(step, context);

        // Check cancellation after async work
        if (executionRef.current.cancelled) {
          store.cancelExecution(lockId);
          executionRef.current.lockId = null;
          return;
        }

        // Store result
        results.set(i, result);

        // Forward signature to subsequent steps
        if (result.signature) {
          lastSignature = result.signature;
        }

        // Mark step complete in store
        store.completeStep(lockId, i, result.txHash, result.signature);

        // Notify caller
        onStepComplete?.(i, result);
      } catch (err) {
        // Check cancellation — don't report errors if cancelled
        if (executionRef.current.cancelled) {
          store.cancelExecution(lockId);
          executionRef.current.lockId = null;
          return;
        }

        const isRejection = isUserRejectionError(err);
        const errorMessage = extractErrorMessage(err);
        const errorCategory = categorizeError(err);

        // Log to Sentry (skip user rejections — those are normal)
        if (!isRejection) {
          Sentry.captureException(err, {
            tags: {
              component: 'useStepExecutor',
              stepType,
              errorCategory,
            },
            extra: {
              stepIndex: i,
              totalSteps: steps.length,
              completedSteps: Array.from(results.keys()),
            },
          });
        }

        // Update store — this releases the lock
        store.failStep(lockId, i, errorMessage);
        executionRef.current.lockId = null;

        // Notify caller
        const error = err instanceof Error ? err : new Error(errorMessage);
        onFailure?.(error, i, isRejection);
        return;
      }
    }

    // ─── All steps complete ────────────────────────────────────────────────
    store.completeExecution(lockId);
    executionRef.current.lockId = null;
    onComplete?.(results);
  }, [executors, store, onComplete, onFailure, onStepComplete]);

  // ───────────────────────────────────────────────────────────────────────────
  // CANCEL
  // ───────────────────────────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    executionRef.current.cancelled = true;
    const lockId = executionRef.current.lockId;
    if (lockId) {
      store.cancelExecution(lockId);
      executionRef.current.lockId = null;
    }
  }, [store]);

  // ───────────────────────────────────────────────────────────────────────────
  // RESET
  // ───────────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    executionRef.current.cancelled = true;
    executionRef.current.lockId = null;
    store.reset();
  }, [store]);

  // ───────────────────────────────────────────────────────────────────────────
  // DERIVED STATE
  // ───────────────────────────────────────────────────────────────────────────

  const currentStep = store.steps[store.currentStepIndex] ?? null;

  return {
    execute,
    reset,
    cancel,
    state: {
      steps: store.steps,
      currentStepIndex: store.currentStepIndex,
      status: store.status,
      isExecuting: store.isExecuting,
      error: store.error,
      executionLockId: store.executionLockId,
    },
    currentStep,
    isExecuting: store.isExecuting,
  };
}
