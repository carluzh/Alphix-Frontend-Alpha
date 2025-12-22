"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TransactionStepper } from '@/components/ui/transaction-stepper';
import { cn } from '@/lib/utils';
import { TokenSymbol, getTokenDefinitions } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { useTransactionFlow, generateStepperSteps } from '@/hooks/useTransactionFlow';
import { toast } from 'sonner';
import { Info, OctagonX, BadgeCheck, AlertTriangle, Maximize } from 'lucide-react';
import { PreviewPositionModal } from './PreviewPositionModal';

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
  
  // Optional slippage control to render between steps and buttons
  slippageControl?: React.ReactNode;
  
  // Optional price impact warning to show underneath slippage control
  priceImpactWarning?: {
    severity: 'medium' | 'high';
    message: string;
  } | null;
  
  // Preview position modal props
  calculatedData?: any;
  tickLower?: string;
  tickUpper?: string;
  amount0?: string;
  amount1?: string;
  currentPrice?: string | null;
  currentPoolTick?: number | null;
  currentPoolSqrtPriceX96?: string | null;
  selectedPoolId?: string;
  poolAPY?: number | null;
  estimatedApy?: string;
  getUsdPriceForSymbol?: (symbol?: string) => number;
  convertTickToPrice?: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
  zapQuote?: {
    expectedToken0Amount?: string;
    expectedToken1Amount?: string;
    priceImpact?: string;
  } | null;
  currentSlippage?: number;
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
  slippageControl,
  priceImpactWarning,
  calculatedData,
  tickLower,
  tickUpper,
  amount0,
  amount1,
  currentPrice,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  selectedPoolId,
  poolAPY,
  estimatedApy,
  getUsdPriceForSymbol,
  convertTickToPrice,
  zapQuote,
  currentSlippage,
}: TransactionFlowPanelProps) {
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { state, actions, getNextStep, canProceed } = useTransactionFlow({
    onFlowComplete: () => {
      // Flow completed successfully
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

  useEffect(() => {
    if (isDepositSuccess && !state.completedSteps.has('executing')) {
      actions.completeStep('executing');
    }
  }, [isDepositSuccess, state.completedSteps, actions]);

  const handleProceed = useCallback(async () => {
    if (!canProceed() || !approvalData || isCheckingApprovals) return;

    const nextStep = getNextStep(approvalData, isZapMode);
    if (!nextStep) return;

    if (!isZapMode && nextStep === 'signing_permit' && (!approvalData.permitBatchData || !approvalData.signatureDetails)) {
      toast.error('Permit data not ready', {
        description: 'Please wait for permit data to load or try refreshing',
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' })
      });
      return;
    }

    actions.lock();
    actions.setStep(nextStep);

    try {
      switch (nextStep) {
        case 'approving_zap_tokens': {
          if (state.completedSteps.has('approving_zap_tokens')) {
            actions.unlock();
            actions.setStep('idle');
            setTimeout(() => handleProceed(), 100);
            return;
          }

          const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
          const outputTokenSymbol = zapInputToken === 'token0' ? token1Symbol : token0Symbol;

          if (approvalData.needsInputTokenERC20Approval) {
            await onApproveToken(inputTokenSymbol);
            actions.completeStep('approving_input');
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            actions.completeStep('approving_input');
          }

          if (approvalData.needsOutputTokenERC20Approval) {
            await onApproveToken(outputTokenSymbol);
            actions.completeStep('approving_output');
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            actions.completeStep('approving_output');
          }

          actions.completeStep('approving_zap_tokens');

          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            await onRefetchApprovals();
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          actions.unlock();
          actions.setStep('idle');
          break;
        }

        case 'approving_token0':
          await onApproveToken(token0Symbol);
          actions.completeStep('approving_token0');
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }
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
          if (onRefetchApprovals) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await onRefetchApprovals();
          }
          if (autoProgressOnApproval) {
            await new Promise(resolve => setTimeout(resolve, 500));
            actions.unlock();
            handleProceed();
            return;
          }
          break;

        case 'signing_permit': {
          toast('Sign in Wallet', { icon: React.createElement(Info, { className: 'h-4 w-4' }) });
          const signature = await onSignPermit();
          if (signature) {
            actions.setPermitSignature(signature);
            actions.completeStep('signing_permit');
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
        }

        case 'executing':
          if (isZapMode) {
            if (!onExecuteZap) throw new Error('Zap execution handler not provided');
            await onExecuteZap();
            actions.completeStep('executing');
          } else {
            await onExecute(state.permitSignature);
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

  const stepperSteps = generateStepperSteps(state, approvalData, token0Symbol, token1Symbol, isZapMode, tokenDefinitions);

  const getButtonText = (): string => {
    if (!approvalData) return executeButtonLabel;
    const nextStep = getNextStep(approvalData, isZapMode);
    switch (nextStep) {
      case 'approving_zap_tokens': return 'Approve Tokens';
      case 'approving_token0': return `Approve ${token0Symbol}`;
      case 'approving_token1': return `Approve ${token1Symbol}`;
      case 'signing_permit': return 'Sign Permit';
      case 'executing': return executeButtonLabel;
      default: return executeButtonLabel;
    }
  };

  const isWorking = state.isLocked || state.currentStep !== 'idle';
  const isDisabled = isWorking || (!state.isLocked && isCheckingApprovals) || !approvalData;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Transaction Steps Display */}
      <div className="p-3 border border-dashed rounded-md bg-muted/10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-foreground/80">Transaction Steps</p>
          {calculatedData && (parseFloat(amount0 || "0") > 0 || parseFloat(amount1 || "0") > 0) && getUsdPriceForSymbol && convertTickToPrice && (
            <button
              onClick={() => setShowPreviewModal(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <Maximize className="h-3 w-3" />
              <span>Preview position</span>
            </button>
          )}
        </div>
        <TransactionStepper steps={stepperSteps} />
      </div>

      {/* Slippage Control (if provided) */}
      {slippageControl && (
        <div className="mb-2">
          {slippageControl}
        </div>
      )}

      {/* Price Impact Warning - shown underneath slippage control for zap mode */}
      {priceImpactWarning && (
        <div className={cn(
          "mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs",
          priceImpactWarning.severity === 'high' 
            ? "bg-red-500/10 text-red-500 border border-red-500/20"
            : "bg-orange-500/10 text-orange-500 border border-orange-500/20"
        )}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="font-medium">{priceImpactWarning.message}</span>
        </div>
      )}

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

      {/* Preview Position Modal */}
      {calculatedData && getUsdPriceForSymbol && convertTickToPrice && (
        <PreviewPositionModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          onConfirm={() => {
            setShowPreviewModal(false);
          }}
          calculatedData={calculatedData}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          tickLower={tickLower || ""}
          tickUpper={tickUpper || ""}
          amount0={amount0 || ""}
          amount1={amount1 || ""}
          currentPrice={currentPrice ?? null}
          currentPoolTick={currentPoolTick ?? null}
          currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
          selectedPoolId={selectedPoolId}
          getUsdPriceForSymbol={getUsdPriceForSymbol}
          convertTickToPrice={convertTickToPrice}
          isZapMode={isZapMode}
          zapInputToken={zapInputToken}
          zapInputAmount={zapInputToken === 'token0' ? amount0 : amount1}
          zapOutputAmount={zapQuote ? (zapInputToken === 'token0' ? zapQuote.expectedToken1Amount : zapQuote.expectedToken0Amount) : undefined}
          zapQuote={zapQuote}
          currentSlippage={currentSlippage}
        />
      )}
    </div>
  );
}