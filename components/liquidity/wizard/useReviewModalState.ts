/**
 * ReviewExecuteModal UI state reducer
 *
 * Manages UI-only concerns for the review/execute modal.
 * Execution state (steps, currentIndex, isExecuting) lives in the
 * executionStore (Zustand) — this reducer handles the rest.
 *
 * Phase 3: Slimmed down from Phase 2 — execution state extracted to store.
 */

import { useReducer, useCallback } from 'react';
import type { TransactionStep } from '@/lib/liquidity/types';
import { useExecutionStore, selectIsLocked } from '@/lib/liquidity/transaction';

// =============================================================================
// STATE
// =============================================================================

type ModalView = 'review' | 'executing';

export interface ReviewModalState {
  /** Current modal view */
  view: ModalView;
  /** Error message (UI-level, not per-step) */
  error: string | null;
  /** Whether a zap preview refetch is in progress */
  isRefetchingPreview: boolean;
  /** C4 flow tracking ID */
  flowId: string | undefined;
  /**
   * Executor steps for UI mapping (mirrors what was passed to the store).
   * Kept here because mapExecutorStepsToUI needs the original TransactionStep
   * objects, not the StepState wrappers in the store.
   */
  executorSteps: TransactionStep[];
}

const INITIAL_STATE: ReviewModalState = {
  view: 'review',
  error: null,
  isRefetchingPreview: false,
  flowId: undefined,
  executorSteps: [],
};

// =============================================================================
// ACTIONS
// =============================================================================

type ReviewModalAction =
  | { type: 'MODAL_OPENED' }
  | { type: 'EXECUTION_STARTED' }
  | { type: 'EXECUTION_STEPS_SET'; steps: TransactionStep[] }
  | { type: 'EXECUTION_SUCCEEDED' }
  | { type: 'EXECUTION_FAILED'; error: string }
  | { type: 'EXECUTION_REJECTED' }
  | { type: 'PREVIEW_REFETCH_STARTED' }
  | { type: 'PREVIEW_REFETCH_ENDED' }
  | { type: 'FLOW_ID_SET'; flowId: string }
  | { type: 'ERROR_CLEARED' };

// =============================================================================
// REDUCER
// =============================================================================

function reviewModalReducer(state: ReviewModalState, action: ReviewModalAction): ReviewModalState {
  switch (action.type) {
    case 'MODAL_OPENED':
      // The execution store's lock prevents reset during execution.
      // Here we just reset UI state.
      return { ...INITIAL_STATE };

    case 'EXECUTION_STARTED':
      return {
        ...state,
        view: 'executing',
        error: null,
      };

    case 'EXECUTION_STEPS_SET':
      return {
        ...state,
        executorSteps: action.steps,
      };

    case 'EXECUTION_SUCCEEDED':
      return { ...state };

    case 'EXECUTION_FAILED':
      return {
        ...state,
        view: 'review',
        error: action.error,
      };

    case 'EXECUTION_REJECTED':
      // User rejected in wallet — return to review so they can retry
      return { ...state, view: 'review' as ModalView };

    case 'PREVIEW_REFETCH_STARTED':
      return { ...state, isRefetchingPreview: true };

    case 'PREVIEW_REFETCH_ENDED':
      return { ...state, isRefetchingPreview: false };

    case 'FLOW_ID_SET':
      return { ...state, flowId: action.flowId };

    case 'ERROR_CLEARED':
      return { ...state, error: null, view: 'review' as ModalView };

    default:
      return state;
  }
}

// =============================================================================
// HOOK
// =============================================================================

export function useReviewModalState() {
  const [uiState, dispatch] = useReducer(reviewModalReducer, INITIAL_STATE);
  const isLocked = useExecutionStore(selectIsLocked);

  const onModalOpened = useCallback(() => {
    // Execution store lock prevents reset during active execution
    if (!isLocked) {
      dispatch({ type: 'MODAL_OPENED' });
    }
  }, [isLocked]);

  const onExecutionStarted = useCallback(() => dispatch({ type: 'EXECUTION_STARTED' }), []);
  const onStepsSet = useCallback((steps: TransactionStep[]) => dispatch({ type: 'EXECUTION_STEPS_SET', steps }), []);
  const onExecutionSucceeded = useCallback(() => dispatch({ type: 'EXECUTION_SUCCEEDED' }), []);
  const onExecutionFailed = useCallback((error: string) => dispatch({ type: 'EXECUTION_FAILED', error }), []);
  const onExecutionRejected = useCallback(() => dispatch({ type: 'EXECUTION_REJECTED' }), []);
  const onPreviewRefetchStarted = useCallback(() => dispatch({ type: 'PREVIEW_REFETCH_STARTED' }), []);
  const onPreviewRefetchEnded = useCallback(() => dispatch({ type: 'PREVIEW_REFETCH_ENDED' }), []);
  const onFlowIdSet = useCallback((flowId: string) => dispatch({ type: 'FLOW_ID_SET', flowId }), []);
  const onErrorCleared = useCallback(() => dispatch({ type: 'ERROR_CLEARED' }), []);

  return {
    state: uiState,
    dispatch,
    onModalOpened,
    onExecutionStarted,
    onStepsSet,
    onExecutionSucceeded,
    onExecutionFailed,
    onExecutionRejected,
    onPreviewRefetchStarted,
    onPreviewRefetchEnded,
    onFlowIdSet,
    onErrorCleared,
  };
}
