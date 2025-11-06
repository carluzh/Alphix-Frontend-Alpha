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
  isZapMode?: boolean;
  zapInputToken?: 'token0' | 'token1';

  // Action handlers
  onApproveToken: (tokenSymbol: TokenSymbol) => Promise<void>;
  onSignPermit: () => Promise<string | undefined>;
  onExecuteZap?: () => Promise<void>; // New consolidated zap handler
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
  isZapMode = false,
  zapInputToken = 'token0',
  onApproveToken,
  onSignPermit,
  onExecuteZap,
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

    const nextStep = getNextStep(approvalData, isZapMode);
    if (!nextStep) return;

    // Validate permit data exists when needed
    if (!isZapMode && nextStep === 'signing_permit' && (!approvalData.permitBatchData || !approvalData.signatureDetails)) {
      console.warn('[TransactionFlow] Permit data not ready');
      return;
    }

    if (isZapMode && nextStep === 'signing_swap_permit' && !approvalData.swapPermitData) {
      console.warn('[TransactionFlow] Swap permit data not ready');
      console.log('[TransactionFlow] Current approvalData:', approvalData);
      return;
    }

    // Note: For signing_batch_permit in zap mode, we DON'T pre-validate batchPermitData
    // because it's fetched dynamically inside handleSignBatchPermit after the swap completes

    actions.lock();
    actions.setStep(nextStep);

    try {
      switch (nextStep) {
        case 'approving_zap_tokens':
          // Safety check: if we've already completed this step, skip to execution
          if (state.completedSteps.has('approving_zap_tokens')) {
            console.warn('[TransactionFlow] Approvals already completed, skipping to execution');
            actions.unlock();
            actions.setStep('idle');
            // Trigger next step
            setTimeout(() => handleProceed(), 100);
            return;
          }

          // Zap mode: Approve BOTH tokens together (prevents spam)
          const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
          const outputTokenSymbol = zapInputToken === 'token0' ? token1Symbol : token0Symbol;

          // Check what needs approval
          const needsInputApproval = approvalData.needsInputTokenERC20Approval;
          const needsOutputApproval = approvalData.needsOutputTokenERC20Approval;

          // Approve input token if needed
          if (needsInputApproval) {
            await onApproveToken(inputTokenSymbol);
            // Mark input as approved for UI progress (1/2)
            actions.completeStep('approving_input');
            // Small delay to ensure blockchain state updates
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            // Already approved, mark as complete for UI
            actions.completeStep('approving_input');
          }

          // Approve output token if needed
          if (needsOutputApproval) {
            await onApproveToken(outputTokenSymbol);
            // Mark output as approved for UI progress (2/2)
            actions.completeStep('approving_output');
            // Small delay to ensure blockchain state updates
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            // Already approved, mark as complete for UI
            actions.completeStep('approving_output');
          }

          // Mark the batch approval as complete
          actions.completeStep('approving_zap_tokens');

          // Now refetch approval data to clear the needsApproval flags
          // Wait longer to ensure blockchain state has updated
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // Increased delay
            await onRefetchApprovals();
            // Wait a bit more for the refetch to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // DO NOT auto-progress after batch approval - user should click Execute
          // Just unlock the UI
          actions.unlock();
          actions.setStep('idle');
          break;

        // Individual approval cases removed - now handled by approving_zap_tokens

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
            await new Promise(resolve => setTimeout(resolve, 500));
            actions.unlock();
            handleProceed();
            return;
          }
          break;

        case 'approving_token1':
          await onApproveToken(token1Symbol);
          actions.completeStep('approving_token1');

          // Refetch approval data to ensure permit data is fresh
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }

          // Auto-progress if enabled
          if (autoProgressOnApproval) {
            await new Promise(resolve => setTimeout(resolve, 500));
            actions.unlock();
            handleProceed();
            return;
          }
          break;

        case 'signing_permit':
          // Regular mode: Sign permit
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
          if (isZapMode) {
            // Zap mode: Execute consolidated swap + deposit flow
            if (!onExecuteZap) throw new Error('Zap execution handler not provided');
            await onExecuteZap();
            // Note: The handler itself manages all toasts and steps internally
            actions.completeStep('executing');
          } else {
            // Regular mode: Execute deposit with permit signature
            toast('Confirm Transaction', {
              icon: React.createElement(Info, { className: 'h-4 w-4' })
            });
            await onExecute(state.permitSignature);
            // Note: Completion is handled by isDepositSuccess effect
          }
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
    isZapMode,
    zapInputToken,
    getNextStep,
    actions,
    token0Symbol,
    token1Symbol,
    onApproveToken,
    onSignPermit,
    onExecuteZap,
    onExecute,
    state.permitSignature,
    autoProgressOnApproval,
  ]);

  // Generate stepper steps from current state
  const stepperSteps = generateStepperSteps(state, approvalData, token0Symbol, token1Symbol, isZapMode);

  // Determine button text based on next action (static, no loading states)
  const getButtonText = (): string => {
    // Prioritize flow state over checking state for snappier transitions
    if (!approvalData) return executeButtonLabel;

    // Show next action only, no loading states
    const nextStep = getNextStep(approvalData, isZapMode);
    const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;

    switch (nextStep) {
      case 'approving_zap_tokens': return 'Approve Tokens';
      case 'approving_token0': return `Approve ${token0Symbol}`;
      case 'approving_token1': return `Approve ${token1Symbol}`;
      case 'signing_swap_permit': return 'Sign Swap Permit';
      case 'swapping': return 'Execute Swap';
      case 'signing_batch_permit': return 'Sign LP Permit';
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