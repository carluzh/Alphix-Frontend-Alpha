'use client';

/**
 * WizardProgress - Step indicator component for wizard
 * Updated for 2-step flow (Uniswap-aligned)
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { WizardStep, WIZARD_STEPS } from '../types';
import { useAddLiquidityContext } from '../AddLiquidityContext';

/**
 * Hook to detect when a sticky element reaches its sticky position
 * Shows a border when the element is "stuck"
 * @see Uniswap's useStickyHeaderBorder pattern
 */
function useStickyBorder(stickyTop: number = 0) {
  const [isSticky, setIsSticky] = useState(false);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleScroll = () => {
      const rect = element.getBoundingClientRect();
      // Element is sticky when its top position reaches the sticky threshold
      setIsSticky(rect.top <= stickyTop + 1); // +1 for rounding tolerance
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial state

    return () => window.removeEventListener('scroll', handleScroll);
  }, [stickyTop]);

  return { isSticky, elementRef };
}

interface ProgressStep {
  id: WizardStep;
  label: string;
  active: boolean;
  completed: boolean;
  canNavigate: boolean;
  onClick?: () => void;
}

const SIDEBAR_WIDTH = 360;
const STICKY_TOP_PX = 24; // top-6 = 24px

/**
 * Sidebar progress indicator for desktop
 * Shows 2 steps with numbers and connecting line
 * Sticky behavior: stays at top when scrolling, with visual feedback
 */
export function WizardProgressSidebar() {
  const { currentStep, setStep } = useAddLiquidityContext();
  const { isSticky, elementRef } = useStickyBorder(STICKY_TOP_PX);

  const steps = getVisibleSteps(currentStep, setStep);

  return (
    <div
      ref={elementRef}
      className={cn(
        // Uniswap pattern: hidden on mobile, flex on lg+, alignSelf flex-start, sticky positioning
        "hidden lg:flex flex-col self-start sticky top-6 rounded-lg py-3 px-4 border bg-container transition-shadow duration-200",
        isSticky
          ? "border-sidebar-border shadow-lg shadow-black/20"
          : "border-sidebar-border"
      )}
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
 * Shows on screens < 1024px (lg breakpoint)
 */
export function WizardProgressHeader() {
  const { currentStep, setStep } = useAddLiquidityContext();
  const { isSticky, elementRef } = useStickyBorder(0);

  const steps = getVisibleSteps(currentStep, setStep);
  const currentIndex = steps.findIndex(s => s.active);
  const currentStepData = steps[currentIndex];

  if (currentIndex === -1 || !currentStepData) {
    return null;
  }

  return (
    <div
      ref={elementRef}
      className={cn(
        "lg:hidden flex flex-row w-full items-center gap-3 px-4 py-3 mb-4 sticky top-0 z-10 transition-all duration-200"
      )}
    >
      {/* Step indicator pill - matches desktop styling with rounded corners and border */}
      <div
        className={cn(
          "flex flex-row items-center gap-3 py-2.5 px-3 rounded-lg border bg-container transition-shadow duration-200 flex-1",
          isSticky
            ? "border-sidebar-border shadow-lg shadow-black/20"
            : "border-sidebar-border"
        )}
      >
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
