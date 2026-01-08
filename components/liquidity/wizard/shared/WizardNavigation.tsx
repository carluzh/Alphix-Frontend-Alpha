'use client';

/**
 * WizardNavigation - Navigation buttons component for wizard
 * Updated for 2-step flow (used primarily in Step 2)
 */

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAddLiquidityContext } from '../AddLiquidityContext';
import { WizardStep } from '../types';

interface WizardNavigationProps {
  onContinue?: () => void;
  onBack?: () => void;
  continueLabel?: string;
  backLabel?: string;
  continueDisabled?: boolean;
  isLoading?: boolean;
  showBack?: boolean;
  className?: string;
}

export function WizardNavigation({
  onContinue,
  onBack,
  continueLabel,
  backLabel = 'Back',
  continueDisabled = false,
  isLoading = false,
  showBack,
  className,
}: WizardNavigationProps) {
  const { goNext, goBack, canGoBack, canGoForward, currentStep } = useAddLiquidityContext();

  const handleContinue = () => {
    if (onContinue) {
      onContinue();
    } else {
      goNext();
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      goBack();
    }
  };

  // Determine if back button should show
  const shouldShowBack = showBack !== undefined ? showBack : canGoBack;

  // Determine continue button label
  const getContinueLabel = () => {
    if (continueLabel) return continueLabel;

    switch (currentStep) {
      case WizardStep.POOL_AND_MODE:
        return 'Continue';
      case WizardStep.RANGE_AND_AMOUNTS:
        return 'Review';
      default:
        return 'Continue';
    }
  };

  return (
    <div className={cn('flex flex-row gap-3 w-full mt-6', className)}>
      {/* Back button */}
      {shouldShowBack && (
        <Button
          variant="outline"
          size="lg"
          onClick={handleBack}
          className="flex-shrink-0"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          {backLabel}
        </Button>
      )}

      {/* Continue button */}
      <Button
        variant="default"
        size="lg"
        onClick={handleContinue}
        disabled={continueDisabled || !canGoForward || isLoading}
        className="flex-1"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            {getContinueLabel()}
            <ChevronRight className="w-4 h-4 ml-1" />
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Simple continue-only button for steps that don't need back navigation
 */
export function ContinueButton({
  label = 'Continue',
  disabled = false,
  isLoading = false,
  onClick,
  className,
}: {
  label?: string;
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const { goNext, canGoForward } = useAddLiquidityContext();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      goNext();
    }
  };

  return (
    <Button
      variant="default"
      size="lg"
      onClick={handleClick}
      disabled={disabled || !canGoForward || isLoading}
      className={cn('w-full', className)}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          {label}
          <ChevronRight className="w-4 h-4 ml-1" />
        </>
      )}
    </Button>
  );
}
