/**
 * Transaction flow panel for single-token zap flow
 * Handles: Calculate → Approve → Sign Swap Permit → Execute Swap → Sign Mint Permit → Deposit
 */

"use client";

import React, { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { TransactionStepper } from '@/components/ui/transaction-stepper';
import { cn } from '@/lib/utils';
import { TokenSymbol } from '@/lib/pools-config';
import { useZapTransactionFlow, generateZapStepperSteps } from '@/hooks/useZapTransactionFlow';
import { toast } from 'sonner';
import { Info, OctagonX } from 'lucide-react';

export interface ZapTransactionFlowPanelProps {
  // Flow configuration
  isActive: boolean;
  approvalData: any; // Combined swap and mint approval data
  isCheckingApprovals: boolean;
  inputTokenSymbol: TokenSymbol;
  outputTokenSymbol: TokenSymbol;
  isSwapSuccess?: boolean; // For detecting when swap is confirmed
  isDepositSuccess?: boolean; // For detecting when deposit is confirmed

  // Action handlers
  onApproveToken: (tokenSymbol: TokenSymbol, isOutput?: boolean) => Promise<void>;
  onSignSwapPermit: () => Promise<string | undefined>;
  onExecuteSwap: (permitSignature?: string) => Promise<string>; // Returns tx hash
  onSignMintPermit: () => Promise<string | undefined>;
  onExecuteDeposit: (mintPermitSignature?: string) => Promise<void>;
  onRefetchApprovals?: () => Promise<any>;
  onBack?: () => void;
  onReset?: () => void;

  // UI customization
  executeButtonLabel?: string;
  showBackButton?: boolean;
  className?: string;
  autoProgressOnApproval?: boolean;
}

export function ZapTransactionFlowPanel({
  isActive,
  approvalData,
  isCheckingApprovals,
  inputTokenSymbol,
  outputTokenSymbol,
  isSwapSuccess,
  isDepositSuccess,
  onApproveToken,
  onSignSwapPermit,
  onExecuteSwap,
  onSignMintPermit,
  onExecuteDeposit,
  onRefetchApprovals,
  onBack,
  onReset,
  executeButtonLabel = 'Start Zap',
  showBackButton = true,
  className,
  autoProgressOnApproval = true,
}: ZapTransactionFlowPanelProps) {
  const { state, actions, getNextStep, canProceed } = useZapTransactionFlow({
    onFlowComplete: () => {
      if (onReset) onReset();
    },
  });

  // Initialize flow when it becomes active
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    if (isActive && !wasActive) {
      actions.startFlow();
    }
    wasActiveRef.current = isActive;
  }, [isActive, actions]);

  // Mark swap step as complete when swap is confirmed
  useEffect(() => {
    if (isSwapSuccess && state.currentStep === 'executing_swap' && !state.completedSteps.has('executing_swap')) {
      actions.completeStep('executing_swap');

      // Refetch approvals for mint step
      if (onRefetchApprovals) {
        setTimeout(() => onRefetchApprovals(), 1000);
      }
    }
  }, [isSwapSuccess, state.currentStep, state.completedSteps, actions, onRefetchApprovals]);

  // Mark deposit step as complete when deposit is confirmed
  useEffect(() => {
    if (isDepositSuccess && state.currentStep === 'depositing' && !state.completedSteps.has('depositing')) {
      actions.completeStep('depositing');
    }
  }, [isDepositSuccess, state.currentStep, state.completedSteps, actions]);

  const handleProceed = useCallback(async () => {
    if (!canProceed() || !approvalData || isCheckingApprovals) {
      console.log('[ZapFlow] Cannot proceed:', { canProceed: canProceed(), approvalData, isCheckingApprovals });
      return;
    }

    const nextStep = getNextStep(approvalData);
    console.log('[ZapFlow] Next step:', nextStep, { approvalData, state });
    if (!nextStep) return;

    actions.lock();
    actions.setStep(nextStep);

    try {
      switch (nextStep) {
        case 'approving_input_token':
          await onApproveToken(inputTokenSymbol, false);
          actions.completeStep('approving_input_token');

          // Refetch approval data
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }

          // Auto-progress
          if (autoProgressOnApproval) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const next = getNextStep(approvalData);
            if (next) {
              actions.unlock();
              handleProceed();
              return;
            }
          }
          break;

        case 'approving_output_token':
          await onApproveToken(outputTokenSymbol, true);
          actions.completeStep('approving_output_token');

          // Refetch approval data
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }

          // Auto-progress
          if (autoProgressOnApproval) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const next = getNextStep(approvalData);
            if (next) {
              actions.unlock();
              handleProceed();
              return;
            }
          }
          break;

        case 'signing_swap_permit':
          toast('Sign Swap Permit', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          const swapSignature = await onSignSwapPermit();
          if (swapSignature) {
            actions.setSwapPermitSignature(swapSignature);
            actions.completeStep('signing_swap_permit');

            // Auto-progress to swap execution
            if (autoProgressOnApproval) {
              await new Promise(resolve => setTimeout(resolve, 500));
              actions.unlock();
              handleProceed();
              return;
            }
          } else {
            throw new Error('Swap permit signature cancelled');
          }
          break;

        case 'executing_swap':
          toast('Confirm Swap Transaction', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          const swapHash = await onExecuteSwap(state.swapPermitSignature || undefined);
          actions.setSwapTxHash(swapHash);
          // Don't mark as complete here - wait for isSwapSuccess
          break;


        case 'signing_mint_permit':
          toast('Sign Mint Permit', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          const mintSignature = await onSignMintPermit();
          if (mintSignature) {
            actions.setMintPermitSignature(mintSignature);
            actions.completeStep('signing_mint_permit');

            // Auto-progress to deposit
            if (autoProgressOnApproval) {
              await new Promise(resolve => setTimeout(resolve, 500));
              actions.unlock();
              handleProceed();
              return;
            }
          } else {
            throw new Error('Mint permit signature cancelled');
          }
          break;

        case 'depositing':
          toast('Confirm Deposit Transaction', {
            icon: React.createElement(Info, { className: 'h-4 w-4' })
          });
          await onExecuteDeposit(state.mintPermitSignature || undefined);
          // Don't mark as complete here - wait for isDepositSuccess
          break;
      }
    } catch (error: any) {
      const isUserRejection =
        error?.message?.toLowerCase().includes('user rejected') ||
        error?.message?.toLowerCase().includes('user denied') ||
        error?.message?.toLowerCase().includes('cancelled') ||
        error?.code === 4001;

      if (!isUserRejection) {
        console.error(`Zap step ${nextStep} failed:`, error);
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
    inputTokenSymbol,
    outputTokenSymbol,
    onApproveToken,
    onSignSwapPermit,
    onExecuteSwap,
    onSignMintPermit,
    onExecuteDeposit,
    onRefetchApprovals,
    state.swapPermitSignature,
    state.mintPermitSignature,
    autoProgressOnApproval,
  ]);

  // Generate stepper steps
  const stepperSteps = generateZapStepperSteps(state, approvalData, inputTokenSymbol, outputTokenSymbol);

  // Determine button text
  const getButtonText = (): string => {
    if (!approvalData) return executeButtonLabel;

    const nextStep = getNextStep(approvalData);
    switch (nextStep) {
      case 'approving_input_token': return `Approve ${inputTokenSymbol}`;
      case 'approving_output_token': return `Approve ${outputTokenSymbol}`;
      case 'signing_swap_permit': return 'Sign Swap Permit';
      case 'executing_swap': return 'Execute Swap';
      case 'signing_mint_permit': return 'Sign Mint Permit';
      case 'depositing': return 'Deposit';
      default: return executeButtonLabel;
    }
  };

  const isWorking = state.isLocked || state.currentStep !== 'idle';
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
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
}
