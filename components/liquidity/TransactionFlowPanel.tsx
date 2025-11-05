"use client";

import React, { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { TransactionStepper } from '@/components/ui/transaction-stepper';
import { cn } from '@/lib/utils';
import { TokenSymbol } from '@/lib/pools-config';
import { useTransactionFlow, generateStepperSteps } from '@/hooks/useTransactionFlow';
import { toast } from 'sonner';
import { Info, OctagonX, BadgeCheck } from 'lucide-react';

export interface TransactionFlowPanelProps {
  // Flow configuration
  isActive: boolean;
  approvalData: any;
  isCheckingApprovals: boolean;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  isDepositSuccess?: boolean; // For detecting when deposit is confirmed

  // Action handlers
  onApproveToken: (tokenSymbol: TokenSymbol) => Promise<void>;
  onSignPermit: () => Promise<string | undefined>;
  onExecute: (permitSignature?: string) => Promise<void>;
  onRefetchApprovals?: () => Promise<any>;
  onBack?: () => void;
  onReset?: () => void;

  // UI customization
  executeButtonLabel?: string;
  showBackButton?: boolean;
  className?: string;

  // Flow control
  autoProgressOnApproval?: boolean; // Auto-move to next step after approval
}

export function TransactionFlowPanel({
  isActive,
  approvalData,
  isCheckingApprovals,
  token0Symbol,
  token1Symbol,
  isDepositSuccess,
  onApproveToken,
  onSignPermit,
  onExecute,
  onRefetchApprovals,
  onBack,
  onReset,
  executeButtonLabel = 'Execute',
  showBackButton = true,
  className,
  autoProgressOnApproval = true,
}: TransactionFlowPanelProps) {
  const { state, actions, getNextStep, canProceed } = useTransactionFlow({
    onFlowComplete: () => {
      // Flow completed successfully
      if (onReset) onReset();
    },
  });

  // Initialize flow when it becomes active
  useEffect(() => {
    if (isActive && !state.currentStep && state.currentStep === 'idle') {
      actions.startFlow();
    }
  }, [isActive, state.currentStep, actions]);

  useEffect(() => {
    if (isDepositSuccess && !state.completedSteps.has('executing')) {
      actions.completeStep('executing');
    }
  }, [isDepositSuccess, state.completedSteps, actions]);

  const handleProceed = useCallback(async () => {
    if (!canProceed() || !approvalData || isCheckingApprovals) return;

    const nextStep = getNextStep(approvalData);
    if (!nextStep) return;

    // Validate permit data exists when needed
    if (nextStep === 'signing_permit' && (!approvalData.permitBatchData || !approvalData.signatureDetails)) {
      console.warn('[TransactionFlow] Permit data not ready');
      return;
    }

    actions.lock();
    actions.setStep(nextStep);

    try {
      switch (nextStep) {
        case 'approving_token0':
          await onApproveToken(token0Symbol);
          actions.completeStep('approving_token0');

          // Refetch approval data to ensure permit data is fresh
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }

          // Auto-progress if enabled
          if (autoProgressOnApproval) {
            // Small delay for smooth transition
            await new Promise(resolve => setTimeout(resolve, 500));
            const nextAfterToken0 = getNextStep(approvalData);
            if (nextAfterToken0) {
              actions.unlock();
              handleProceed(); // Recursively proceed to next step
              return;
            }
          }
          break;

        case 'approving_token1':
          // Toast is shown by the hook, no need to duplicate
          await onApproveToken(token1Symbol);
          actions.completeStep('approving_token1');

          // Refetch approval data to ensure permit data is fresh
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }

          // Auto-progress if enabled
          if (autoProgressOnApproval) {
            // Small delay for smooth transition
            await new Promise(resolve => setTimeout(resolve, 500));
            const nextAfterToken1 = getNextStep(approvalData);
            if (nextAfterToken1) {
              actions.unlock();
              handleProceed(); // Recursively proceed to next step
              return;
            }
          }
          break;

        case 'signing_permit':
          toast('Sign in Wallet', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          const signature = await onSignPermit();
          if (signature) {
            actions.setPermitSignature(signature);
            actions.completeStep('signing_permit');

            // Auto-progress to execution
            if (autoProgressOnApproval) {
              await new Promise(resolve => setTimeout(resolve, 500));
              actions.unlock();
              handleProceed();
              return;
            }
          } else {
            throw new Error('Signature cancelled');
          }
          break;

        case 'executing':
          toast('Confirm Transaction', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          await onExecute(state.permitSignature);
          break;
      }
    } catch (error: any) {
      const isUserRejection =
        error?.message?.toLowerCase().includes('user rejected') ||
        error?.message?.toLowerCase().includes('user denied') ||
        error?.message?.toLowerCase().includes('cancelled') ||
        error?.code === 4001;

      if (!isUserRejection) {
        console.error(`Step ${nextStep} failed:`, error);
        actions.setError(error.message);
        toast.error('Transaction Failed', {
          icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
          description: error.message,
        });
      }
    } finally {
      actions.unlock();
      actions.setStep('idle');
    }
  }, [
    canProceed,
    approvalData,
    isCheckingApprovals,
    getNextStep,
    actions,
    token0Symbol,
    token1Symbol,
    onApproveToken,
    onSignPermit,
    onExecute,
    state.permitSignature,
    autoProgressOnApproval,
  ]);

  // Generate stepper steps from current state
  const stepperSteps = generateStepperSteps(state, approvalData, token0Symbol, token1Symbol);

  // Determine button text based on next action (static, no loading states)
  const getButtonText = (): string => {
    // Prioritize flow state over checking state for snappier transitions
    if (!approvalData) return executeButtonLabel;

    // Show next action only, no loading states
    const nextStep = getNextStep(approvalData);
    switch (nextStep) {
      case 'approving_token0': return `Approve ${token0Symbol}`;
      case 'approving_token1': return `Approve ${token1Symbol}`;
      case 'signing_permit': return 'Sign Permit';
      case 'executing': return executeButtonLabel;
      default: return executeButtonLabel; // Default to execute label when all steps complete
    }
  };

  const isWorking = state.isLocked || state.currentStep !== 'idle';
  // Don't disable during refetch if we're already in a transaction flow
  const isDisabled = isWorking || (!state.isLocked && isCheckingApprovals) || !approvalData;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Transaction Steps Display */}
      <div className="p-3 border border-dashed rounded-md bg-muted/10">
        <p className="text-sm font-medium mb-3 text-foreground/80">Transaction Steps</p>
        <TransactionStepper steps={stepperSteps} />
      </div>

      {/* Action Buttons */}
      <div className={cn("flex", showBackButton ? "gap-2" : "")}>
        {showBackButton && onBack && (
          <Button
            variant="outline"
            className="w-1/3 border-sidebar-border bg-button hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all duration-200"
            onClick={onBack}
            disabled={isWorking}
            style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Back
          </Button>
        )}
        <Button
          className={cn(
            showBackButton ? "flex-1" : "w-full",
            isDisabled
              ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
              : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
          )}
          onClick={handleProceed}
          disabled={isDisabled}
          style={isDisabled ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <span className={isWorking ? "animate-pulse" : ""}>
            {getButtonText()}
          </span>
        </Button>
      </div>

      {/* Error Display */}
      {state.error && (
        <p className="text-xs text-red-500 text-center">{state.error}</p>
      )}
    </div>
  );
}