/**
 * Execution Store — Zustand store for transaction step execution state
 *
 * Mirrors Uniswap's activePlanStore pattern:
 * - Single source of truth for execution state (steps, current index, status)
 * - Execution lock prevents external mutations during active step execution
 * - UI reads from this store via selectors, never writes directly
 *
 * @see interface/packages/uniswap/src/features/transactions/swap/review/stores/activePlan/activePlanStore.ts
 */

import { create } from 'zustand';
import type { TransactionStep, FlowStatus, StepState } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface ExecutionState {
  /** Ordered step states with status tracking */
  steps: StepState[];
  /** Index of the currently executing step */
  currentStepIndex: number;
  /** Overall execution status */
  status: FlowStatus;
  /** Whether execution is in progress */
  isExecuting: boolean;
  /** Error message if execution failed */
  error?: string;
  /**
   * Execution lock — when set, prevents MODAL_OPENED from resetting state.
   * Set to a unique ID when execution starts, cleared when it ends.
   * This is the key protection against the "wizard reset" bug.
   */
  executionLockId: string | null;
}

interface ExecutionActions {
  /**
   * Start a new execution. Sets the lock and initializes steps.
   * Returns the lock ID (used to verify ownership).
   */
  startExecution: (steps: TransactionStep[]) => string;

  /**
   * Update a step's status during execution.
   * Only succeeds if the caller holds the execution lock.
   */
  updateStep: (lockId: string, stepIndex: number, update: Partial<StepState>) => void;

  /**
   * Advance to the next step. Called after a step completes.
   * Only succeeds if the caller holds the execution lock.
   */
  completeStep: (lockId: string, stepIndex: number, txHash?: string, signature?: string) => void;

  /**
   * Mark a step as failed. Releases the lock.
   */
  failStep: (lockId: string, stepIndex: number, error: string) => void;

  /**
   * Mark execution as complete. Releases the lock.
   */
  completeExecution: (lockId: string) => void;

  /**
   * Cancel execution. Releases the lock.
   */
  cancelExecution: (lockId: string) => void;

  /**
   * Reset store to initial state. Only works when not locked.
   */
  reset: () => void;
}

export type ExecutionStore = ExecutionState & ExecutionActions;

// =============================================================================
// INITIAL STATE
// =============================================================================

const INITIAL_STATE: ExecutionState = {
  steps: [],
  currentStepIndex: 0,
  status: 'idle',
  isExecuting: false,
  error: undefined,
  executionLockId: null,
};

// =============================================================================
// STORE
// =============================================================================

let lockCounter = 0;

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  ...INITIAL_STATE,

  startExecution: (steps: TransactionStep[]) => {
    const state = get();
    // Prevent double-start: if already locked, return existing lock
    if (state.executionLockId) return state.executionLockId;

    const lockId = `exec_${++lockCounter}_${Date.now()}`;
    set({
      steps: steps.map(step => ({
        step,
        status: 'pending' as FlowStatus,
      })),
      currentStepIndex: 0,
      status: 'loading',
      isExecuting: true,
      error: undefined,
      executionLockId: lockId,
    });
    return lockId;
  },

  updateStep: (lockId: string, stepIndex: number, update: Partial<StepState>) => {
    const state = get();
    if (state.executionLockId !== lockId) return; // Lock mismatch — ignore stale update

    set(prev => {
      const newSteps = [...prev.steps];
      if (newSteps[stepIndex]) {
        newSteps[stepIndex] = { ...newSteps[stepIndex], ...update };
      }
      return {
        steps: newSteps,
        currentStepIndex: stepIndex,
      };
    });
  },

  completeStep: (lockId: string, stepIndex: number, txHash?: string, signature?: string) => {
    const state = get();
    if (state.executionLockId !== lockId) return;

    set(prev => {
      const newSteps = [...prev.steps];
      if (newSteps[stepIndex]) {
        newSteps[stepIndex] = {
          ...newSteps[stepIndex],
          status: 'completed',
          txHash: txHash as any,
          signature,
        };
      }
      return { steps: newSteps };
    });
  },

  failStep: (lockId: string, stepIndex: number, error: string) => {
    const state = get();
    if (state.executionLockId !== lockId) return;

    set(prev => {
      const newSteps = [...prev.steps];
      if (newSteps[stepIndex]) {
        newSteps[stepIndex] = {
          ...newSteps[stepIndex],
          status: 'error',
          error,
        };
      }
      return {
        steps: newSteps,
        status: 'error',
        error,
        isExecuting: false,
        executionLockId: null, // Release lock on failure
      };
    });
  },

  completeExecution: (lockId: string) => {
    const state = get();
    if (state.executionLockId !== lockId) return;

    set({
      status: 'completed',
      isExecuting: false,
      executionLockId: null,
    });
  },

  cancelExecution: (lockId: string) => {
    const state = get();
    if (state.executionLockId !== lockId) return;

    set({
      status: 'idle',
      isExecuting: false,
      executionLockId: null,
    });
  },

  reset: () => {
    const state = get();
    // Cannot reset while execution is locked
    if (state.executionLockId) return;
    set(INITIAL_STATE);
  },
}));

// =============================================================================
// SELECTORS — for fine-grained subscriptions
// =============================================================================

/** Whether execution is currently locked (in-flight) */
export const selectIsLocked = (state: ExecutionStore) => state.executionLockId !== null;

/** Current step state (for ProgressIndicator) */
export const selectCurrentStepState = (state: ExecutionStore) =>
  state.steps[state.currentStepIndex] ?? null;

/** All step states */
export const selectSteps = (state: ExecutionStore) => state.steps;

/** Execution status */
export const selectExecutionStatus = (state: ExecutionStore) => ({
  isExecuting: state.isExecuting,
  status: state.status,
  error: state.error,
  currentStepIndex: state.currentStepIndex,
});
