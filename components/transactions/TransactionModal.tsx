'use client';

/**
 * TransactionModal — Shared modal shell for ALL transaction flows
 *
 * One modal used by every flow: swap, create position, increase, decrease,
 * collect fees, zap deposit, UY deposit/withdraw.
 *
 * Each flow provides:
 * - Review content (children) — the token amounts, price display, etc.
 * - Flow definition — step generation + executors (via useStepExecutor)
 * - Config — title, confirm button text, success behavior
 *
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 4
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconXmark } from 'nucleo-micro-bold-essential';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProgressIndicator } from '@/components/transactions/ProgressIndicator';
import { ErrorCallout } from '@/components/liquidity/wizard/shared/ReviewComponents';
import {
  useStepExecutor,
  type StepResult,
  type StepGenerationResult,
  type StepExecutorFn,
} from '@/lib/transactions/useStepExecutor';
import type { TransactionStep, CurrentStepState } from '@/lib/transactions/types';

// =============================================================================
// TYPES
// =============================================================================

type ModalView = 'review' | 'executing' | 'success';

export interface TransactionModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Modal title — stays visible during execution */
  title: string;
  /** Confirm button text */
  confirmText: string;
  /** Whether confirm is disabled (flow-specific validation) */
  confirmDisabled?: boolean;
  /** The review content — unique per flow */
  children: React.ReactNode;
  /** Step generation function — called when user clicks confirm */
  generateSteps: () => Promise<StepGenerationResult>;
  /** Map of step type → executor function */
  executors: Record<string, StepExecutorFn>;
  /** UI steps for ProgressIndicator (mapped from generated steps) */
  mapStepsToUI?: (steps: unknown[]) => TransactionStep[];
  /** Pre-execution hook (chain switching, quote refresh, etc.) */
  onBeforeExecute?: () => Promise<boolean>;
  /** Called on successful completion */
  onSuccess?: (results: Map<number, StepResult>) => void;
  /** Success behavior: 'close' (default) or 'show' (render success view) */
  successBehavior?: 'close' | 'show';
  /** Render success content (when successBehavior is 'show') */
  renderSuccess?: (results: Map<number, StepResult>) => React.ReactNode;
  /** Optional back button — presence enables 2-column button layout */
  onBack?: () => void;
  /** Extra content rendered below ProgressIndicator during execution */
  renderExecutingExtra?: React.ReactNode;
  /** Content rendered between review content and buttons (e.g., gas estimates) */
  renderFooterExtra?: React.ReactNode;
  /** Override ProgressIndicator banner and active step subtitle (e.g. "Building Transaction...") */
  statusText?: string;
  /** Called when execution ends (success, failure, or rejection) — useful for cleanup like resuming refetch */
  onExecutionEnd?: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TransactionModal({
  open,
  onClose,
  title,
  confirmText,
  confirmDisabled = false,
  children,
  generateSteps,
  executors,
  mapStepsToUI,
  onBeforeExecute,
  onSuccess,
  successBehavior = 'close',
  renderSuccess,
  onBack,
  renderExecutingExtra,
  renderFooterExtra,
  statusText,
  onExecutionEnd,
}: TransactionModalProps) {
  // ─── Local UI state ──────────────────────────────────────────────────────
  const [view, setView] = useState<ModalView>('review');
  const [error, setError] = useState<string | null>(null);
  const [uiSteps, setUiSteps] = useState<TransactionStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [successResults, setSuccessResults] = useState<Map<number, StepResult>>(new Map());

  // ─── Step orchestrator ───────────────────────────────────────────────────
  const { execute, reset, cancel, isExecuting } = useStepExecutor({
    executors,
    onComplete: useCallback((results: Map<number, StepResult>) => {
      if (successBehavior === 'show') {
        setSuccessResults(results);
        setView('success');
      } else {
        onSuccess?.(results);
        onClose();
      }
    }, [successBehavior, onSuccess, onClose]),
    onFailure: useCallback((err: Error, stepIndex: number, isRejection: boolean) => {
      if (isRejection) {
        // User rejected — silently return to review
        setView('review');
        setUiSteps([]);
        setCurrentStepIndex(0);
        setStepAccepted(false);
      } else {
        setError(err.message);
        setView('review');
      }
      onExecutionEnd?.();
    }, [onExecutionEnd]),
    onStepComplete: useCallback((stepIndex: number, _result: StepResult) => {
      setCurrentStepIndex(stepIndex + 1);
      setStepAccepted(false);
    }, []),
  });

  // ─── Reset state when modal opens ────────────────────────────────────────
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      // Rising-edge: modal just opened
      setView('review');
      setError(null);
      setUiSteps([]);
      setCurrentStepIndex(0);
      setStepAccepted(false);
      setSuccessResults(new Map());
      reset();
    }
  }, [open, reset]);

  // ─── Close handler (blocked during execution) ───────────────────────────
  const handleClose = useCallback(() => {
    if (isExecuting) return;
    cancel();
    onClose();
  }, [isExecuting, cancel, onClose]);

  // ─── Confirm handler ────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (isExecuting || view === 'executing') return;

    setError(null);
    setView('executing');

    try {
      // Pre-execution hook (chain switch, quote refresh, etc.)
      if (onBeforeExecute) {
        const proceed = await onBeforeExecute();
        if (!proceed) {
          setView('review');
          return;
        }
      }

      // Generate steps
      const stepsResult = await generateSteps();

      // Map steps to UI representation
      if (mapStepsToUI) {
        setUiSteps(mapStepsToUI(stepsResult.steps));
      }
      setCurrentStepIndex(0);
      setStepAccepted(false);

      // Execute
      await execute(stepsResult);
    } catch (err) {
      // generateSteps or onBeforeExecute threw
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setView('review');
    }
  }, [isExecuting, view, onBeforeExecute, generateSteps, mapStepsToUI, execute]);

  // ─── Retry handler ──────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setError(null);
    reset();
  }, [reset]);

  // ─── Success done handler ───────────────────────────────────────────────
  const handleSuccessDone = useCallback(() => {
    onSuccess?.(successResults);
    onClose();
  }, [onSuccess, successResults, onClose]);

  // ─── Current step for ProgressIndicator ─────────────────────────────────
  const currentStep = useMemo((): CurrentStepState | undefined => {
    if (uiSteps.length === 0 || currentStepIndex >= uiSteps.length) return undefined;
    return { step: uiSteps[currentStepIndex], accepted: stepAccepted };
  }, [uiSteps, currentStepIndex, stepAccepted]);

  // ─── Disabled state ─────────────────────────────────────────────────────
  const isConfirmDisabled = isExecuting || view === 'executing' || confirmDisabled;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="sm:max-w-[420px] bg-container border-sidebar-border p-0 gap-0 [&>button]:hidden"
        onPointerDownOutside={(e) => { if (isExecuting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isExecuting) e.preventDefault(); }}
      >
        {/* ── Success View ─────────────────────────────────────────────── */}
        {view === 'success' && renderSuccess ? (
          <div className="p-4">
            {renderSuccess(successResults)}
            <Button
              onClick={handleSuccessDone}
              className="w-full h-12 mt-4 text-base font-semibold"
            >
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-base font-medium text-muted-foreground">
                {title}
              </h3>
              <button
                onClick={handleClose}
                disabled={isExecuting}
                className="p-1 rounded-md text-muted-foreground hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconXmark className="w-4 h-4" />
              </button>
            </div>

            {/* ── Review Content — always visible so user sees context ── */}
            <div className="px-4 py-3">
              {children}
            </div>

            {/* ── Error Callout ────────────────────────────────────────── */}
            {error && (
              <div className="px-4 pb-2">
                <ErrorCallout error={error} onRetry={handleRetry} />
              </div>
            )}

            {/* ── Footer Extra (gas estimate, etc.) ────────────────────── */}
            {view === 'review' && renderFooterExtra && (
              <div className="px-4 pb-2">
                {renderFooterExtra}
              </div>
            )}

            {/* ── Bottom Section: Progress or Button ───────────────────── */}
            <div className="p-4 pt-2">
              {view === 'executing' && currentStep && uiSteps.length > 0 ? (
                <>
                  <ProgressIndicator steps={uiSteps} currentStep={currentStep} statusText={statusText} />
                  {renderExecutingExtra}
                </>
              ) : view !== 'success' ? (
                onBack ? (
                  // Two-column layout with Back button
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      onClick={onBack}
                      disabled={isExecuting}
                      className="h-12 text-base font-semibold"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      disabled={isConfirmDisabled}
                      className="h-12 text-base font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
                    >
                      {confirmText}
                    </Button>
                  </div>
                ) : (
                  // Single button layout
                  <Button
                    onClick={handleConfirm}
                    disabled={isConfirmDisabled}
                    className="w-full h-12 text-base font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
                  >
                    {confirmText}
                  </Button>
                )
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
