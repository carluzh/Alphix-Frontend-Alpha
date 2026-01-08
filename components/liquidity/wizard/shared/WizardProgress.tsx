'use client';

/**
 * WizardProgress - Step indicator component for wizard
 * Updated for 2-step flow (Uniswap-aligned)
 */

import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { WizardStep, WIZARD_STEPS } from '../types';
import { useAddLiquidityContext } from '../AddLiquidityContext';

interface ProgressStep {
  id: WizardStep;
  label: string;
  active: boolean;
  completed: boolean;
  canNavigate: boolean;
  onClick?: () => void;
}

const SIDEBAR_WIDTH = 360;

/**
 * Sidebar progress indicator for desktop
 * Shows 2 steps with numbers and connecting line
 */
export function WizardProgressSidebar() {
  const { currentStep, setStep } = useAddLiquidityContext();

  const steps = getVisibleSteps(currentStep, setStep);

  return (
    <div
      className="hidden xl:flex flex-col self-start sticky top-24 rounded-lg py-3 px-4 border border-sidebar-border bg-container"
      style={{ width: SIDEBAR_WIDTH }}
    >
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          <button
            onClick={() => step.canNavigate && step.onClick?.()}
            disabled={!step.canNavigate}
            className={cn(
              'flex flex-row gap-3 items-center py-2.5 px-2 rounded-lg transition-colors',
              step.canNavigate && 'cursor-pointer hover:bg-sidebar-accent',
              !step.canNavigate && 'cursor-default'
            )}
          >
            {/* Step number - rounded rectangle */}
            <div
              className={cn(
                'h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                step.active
                  ? 'bg-muted text-foreground'
                  : step.completed
                    ? 'bg-green-500/15 text-green-500'
                    : 'bg-sidebar-accent text-muted-foreground'
              )}
            >
              {step.completed && !step.active ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <span className="text-xs font-semibold select-none font-[Consolas,monospace]">{index + 1}</span>
              )}
            </div>

            {/* Step label */}
            <div className="flex flex-col gap-0.5 text-left font-[Inter]">
              <span
                className={cn(
                  'text-[10px] uppercase tracking-wider font-semibold select-none',
                  step.active ? 'text-muted-foreground' : 'text-muted-foreground/60'
                )}
              >
                Step {index + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium select-none',
                  step.active ? 'text-foreground' : 'text-muted-foreground/70'
                )}
              >
                {step.label}
              </span>
            </div>
          </button>

          {/* Connecting line */}
          {index !== steps.length - 1 && (
            <div
              className={cn(
                'w-0.5 h-6 ml-[13px] my-1 rounded-full transition-colors',
                steps[index + 1].active || steps[index + 1].completed
                  ? 'bg-green-500/30'
                  : 'bg-sidebar-border'
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Header progress indicator for mobile/tablet
 */
export function WizardProgressHeader() {
  const { currentStep, setStep } = useAddLiquidityContext();

  const steps = getVisibleSteps(currentStep, setStep);
  const currentIndex = steps.findIndex(s => s.active);
  const currentStepData = steps[currentIndex];

  if (currentIndex === -1 || !currentStepData) {
    return null;
  }

  return (
    <div className="xl:hidden flex flex-row w-full items-center justify-between gap-3 p-4 bg-container border-b border-sidebar-border sticky top-0 z-10">
      {/* Step number - rounded rectangle */}
      <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-foreground font-[Consolas,monospace]">
          {currentIndex + 1}
        </span>
      </div>

      {/* Step info */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 font-[Inter]">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
          Step {currentIndex + 1} of {steps.length}
        </span>
        <span className="text-sm font-medium text-foreground truncate">
          {currentStepData.label}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact dot indicator for very small screens
 */
export function WizardProgressDots() {
  const { currentStep, setStep } = useAddLiquidityContext();
  const steps = getVisibleSteps(currentStep, setStep);

  return (
    <div className="flex flex-row gap-2 justify-center py-4">
      {steps.map((step) => (
        <button
          key={step.id}
          onClick={() => step.canNavigate && step.onClick?.()}
          disabled={!step.canNavigate}
          className={cn(
            'w-2 h-2 rounded-full transition-colors',
            step.active
              ? 'bg-foreground/60'
              : step.completed
                ? 'bg-green-500'
                : 'bg-sidebar-accent',
            step.canNavigate && 'cursor-pointer hover:opacity-80'
          )}
        />
      ))}
    </div>
  );
}

/**
 * Helper to get visible steps (just 2 now)
 * Allows clicking to go back (not forward)
 */
function getVisibleSteps(
  currentStep: WizardStep,
  setStep: (step: WizardStep) => void
): ProgressStep[] {
  return WIZARD_STEPS.map(step => {
    const isCompleted = currentStep > step.id;
    const isActive = currentStep === step.id;
    const canNavigate = isCompleted && !isActive;

    return {
      id: step.id,
      label: step.title,
      active: isActive,
      completed: isCompleted,
      canNavigate,
      onClick: () => {
        if (canNavigate) {
          setStep(step.id);
        }
      },
    };
  });
}
