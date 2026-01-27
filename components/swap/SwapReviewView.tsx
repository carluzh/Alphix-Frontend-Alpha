"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ChevronRightIcon,
  CoinsIcon,
  FileTextIcon,
  WalletIcon
} from "lucide-react";
import { IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Token, SwapProgressState } from './swap-interface';
import { Spinner } from "@/components/ui/spinner";
import type { SwapTradeModel, PriceImpactWarning } from "./useSwapTrade";

// Forward declare props that might come from the main interface or be defined here
interface SwapReviewViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  trade: SwapTradeModel;
  handleChangeButton: () => void;
  handleConfirmSwap: () => void;
  swapProgressState: SwapProgressState;
  completedSteps: SwapProgressState[];
  isSwapping: boolean;
}

// Helper function to render the step indicator with modern style matching AddLiquidityForm
const renderStepIndicator = (step: string, currentStep: SwapProgressState, completed: SwapProgressState[]) => {
  const isActive =
    (step === "approval" && ["needs_approval", "approving", "waiting_approval"].includes(currentStep)) ||
    (step === "signature" && ["needs_signature", "signing_permit"].includes(currentStep)) ||
    (step === "transaction" && ["ready_to_swap", "building_tx", "executing_swap", "waiting_confirmation"].includes(currentStep));

  const isLoading =
    (step === "approval" && currentStep === "approving") ||
    (step === "signature" && currentStep === "signing_permit") ||
    (step === "transaction" && (currentStep === "building_tx" || currentStep === "executing_swap"));

  const isCompleted =
    (step === "approval" && completed.includes("approval_complete")) ||
    (step === "signature" && completed.includes("signature_complete")) ||
    (step === "transaction" && completed.includes("complete"));

  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">
        {step === "approval" && "Token Approval"}
        {step === "signature" && "Sign Token Allowance"}
        {step === "transaction" && "Send Swap Transaction"}
      </span>
      <span>
        {isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <span className={`text-xs font-mono ${isCompleted ? 'text-green-500' : 'text-muted-foreground'}`}>
            {isCompleted ? '1/1' : '0/1'}
          </span>
        )}
      </span>
    </div>
  );
};

// Helper function for step icon (can be moved from SwapInterface or passed as prop)
const getStepIcon = (step: 'approval' | 'signature' | 'transaction', size: 'large' | 'small' = 'large') => {
  const iconSize = size === 'large' ? "h-8 w-8" : "h-6 w-6";
  const iconColor = "text-white";
  
  switch(step) {
    case "approval":
      return <CoinsIcon className={`${iconSize} ${iconColor}`} />;
    case "signature":
      return <FileTextIcon className={`${iconSize} ${iconColor}`} />;
    case "transaction":
      return <WalletIcon className={`${iconSize} ${iconColor}`} />;
    default:
      return <FileTextIcon className={`${iconSize} ${iconColor}`} />;
  }
};

// Helper function to get current step index
const getCurrentStepIndex = (swapProgressState: SwapProgressState): number => {
  if (["needs_approval", "approving", "waiting_approval", "approval_complete"].includes(swapProgressState)) {
    return 0; // approval
  }
  if (["needs_signature", "signing_permit", "signature_complete"].includes(swapProgressState)) {
    return 1; // signature
  }
  if (["ready_to_swap", "building_tx", "executing_swap", "waiting_confirmation", "complete"].includes(swapProgressState)) {
    return 2; // transaction
  }
  return 0; // default to approval
};

// Helper function to get step title (static per step, doesn't change based on processing state)
const getStepTitle = (step: 'approval' | 'signature' | 'transaction'): string => {
  switch(step) {
    case "approval":
      return "Approve Token";
    case "signature":
      return "Sign Permission";
    case "transaction":
      return "Confirm Swap";
    default:
      return "Confirm Swap";
  }
};

// Helper function to get step subtitle (static per step, doesn't change based on processing state)
const getStepSubtitle = (step: 'approval' | 'signature' | 'transaction', displayFromToken: any, displayToToken: any, fromAmount: string): string => {
  switch(step) {
    case "approval":
      return `${displayFromToken.symbol}`;
    case "signature":
      return `for ${fromAmount} ${displayFromToken.symbol}`;
    case "transaction":
      return `${displayFromToken.symbol} to ${displayToToken.symbol}`;
    default:
      return `${displayFromToken.symbol} to ${displayToToken.symbol}`;
  }
};

// Helper function to check if step is active (spinning)
const isStepActive = (step: 'approval' | 'signature' | 'transaction', swapProgressState: SwapProgressState): boolean => {
  switch(step) {
    case "approval":
      return swapProgressState === "approving";
    case "signature":
      return swapProgressState === "signing_permit";
    case "transaction":
      return swapProgressState === "building_tx" || swapProgressState === "executing_swap";
    default:
      return false;
  }
};

// Helper function to check if step is waiting (pulsing)
const isStepWaiting = (step: 'approval' | 'signature' | 'transaction', swapProgressState: SwapProgressState): boolean => {
  switch(step) {
    case "approval":
      return swapProgressState === "waiting_approval";
    case "signature":
      return false; // No waiting state for signature
    case "transaction":
      return swapProgressState === "waiting_confirmation";
    default:
      return false;
  }
};

export function SwapReviewView({
  displayFromToken,
  displayToToken,
  trade,
  handleChangeButton,
  handleConfirmSwap,
  swapProgressState,
  completedSteps,
  isSwapping
}: SwapReviewViewProps) {
  // Price impact acknowledgment state - Uniswap pattern
  const [priceImpactAcknowledged, setPriceImpactAcknowledged] = useState(false);

  // Reset acknowledgment when price impact changes or when returning to review
  useEffect(() => {
    setPriceImpactAcknowledged(false);
  }, [trade.priceImpact]);

  // Determine if we need acknowledgment (high severity = 5%+)
  const requiresAcknowledgment = trade.priceImpactWarning?.severity === 'high';
  const canProceed = !requiresAcknowledgment || priceImpactAcknowledged;

  return (
    <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div 
        className="mb-6 flex items-center justify-between rounded-lg border border-primary p-4 hover:bg-muted/30 transition-colors cursor-pointer" 
        onClick={handleChangeButton}
      >
        <div className="flex items-center gap-3">
          <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={32} height={32} className="rounded-full"/>
          <div className="text-left flex flex-col">
            <div className="font-medium flex items-baseline">
              {trade.calculatedValues.fromTokenAmount.startsWith("< ") ? (
                <span className="text-xs text-muted-foreground">{trade.calculatedValues.fromTokenAmount}</span>
              ) : (
                <span className="text-sm">{trade.calculatedValues.fromTokenAmount}</span>
              )}
              <span className="ml-1 text-xs text-muted-foreground">{displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{trade.calculatedValues.fromTokenValue}</div>
          </div>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {trade.calculatedValues.toTokenAmount.startsWith("< ") ? (
                <span className="text-xs text-muted-foreground">{trade.calculatedValues.toTokenAmount}</span>
              ) : (
                <span className="text-sm">{trade.calculatedValues.toTokenAmount}</span>
              )}
              <span className="ml-1 text-xs text-muted-foreground">{displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{trade.calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={32} height={32} className="rounded-full"/>
        </div>
      </div>
      <div className="p-3 border border-dashed rounded-md bg-muted/10 mb-6">
        <p className="text-sm font-medium mb-3 text-foreground/80">Transaction Steps</p>
        <div className="space-y-1.5 text-xs">
          {renderStepIndicator("approval", swapProgressState, completedSteps)}
          {renderStepIndicator("signature", swapProgressState, completedSteps)}
          {renderStepIndicator("transaction", swapProgressState, completedSteps)}
        </div>
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        {/* Simple 3-Step Display */}
        <div className="mb-4 flex items-center justify-center gap-8 w-full h-16">
          {(['approval', 'signature', 'transaction'] as const).map((step, index) => {
            const currentStepIndex = getCurrentStepIndex(swapProgressState);
            const isCurrent = index === currentStepIndex;
            const isActive = isStepActive(step, swapProgressState);
            const isWaiting = isStepWaiting(step, swapProgressState);
            
            return (
              <motion.div
                key={step}
                className={`flex items-center justify-center rounded-full bg-button border border-primary overflow-hidden ${
                  isActive ? 'animate-pulse' : ''
                }`}
                initial={false}
                animate={{
                  scale: isCurrent ? 1 : 0.75,
                  opacity: isCurrent ? 1 : 0.4,
                  width: isCurrent ? 64 : 48,
                  height: isCurrent ? 64 : 48,
                }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                }}
                style={{
                  backgroundImage: 'url(/patterns/button-wide.svg)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {getStepIcon(step, isCurrent ? 'large' : 'small')}
              </motion.div>
            );
          })}
        </div>
        
        <div className="text-center">
          <h3 className="text-lg font-medium">
            {(() => {
              const currentStepIndex = getCurrentStepIndex(swapProgressState);
              const currentStep = ['approval', 'signature', 'transaction'][currentStepIndex] as 'approval' | 'signature' | 'transaction';
              return getStepTitle(currentStep);
            })()}
          </h3>
          <p className="text-muted-foreground mt-1">
            {(() => {
              const currentStepIndex = getCurrentStepIndex(swapProgressState);
              const currentStep = ['approval', 'signature', 'transaction'][currentStepIndex] as 'approval' | 'signature' | 'transaction';
              return getStepSubtitle(currentStep, displayFromToken, displayToToken, trade.calculatedValues.fromTokenAmount);
            })()}
          </p>
        </div>
      </div>
      {/* Price Impact Warning with Acknowledgment - Uniswap pattern */}
      {trade.priceImpactWarning && (
        <div className={cn(
          "mb-4 flex flex-col gap-2 rounded-md px-3 py-3 text-xs",
          trade.priceImpactWarning.severity === 'high'
            ? "bg-red-500/10 text-red-500 border border-red-500/20"
            : "bg-orange-500/10 text-orange-500 border border-orange-500/20"
        )}>
          <div className="flex items-center gap-2">
            <IconTriangleWarningFilled className="h-4 w-4 shrink-0" />
            <span className="font-medium">{trade.priceImpactWarning.message}</span>
          </div>
          {requiresAcknowledgment && (
            <label className="flex items-center gap-2 cursor-pointer mt-1">
              <Checkbox
                checked={priceImpactAcknowledged}
                onCheckedChange={(checked) => setPriceImpactAcknowledged(checked === true)}
                className="border-red-500/50 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
              />
              <span className="text-xs text-muted-foreground">
                I acknowledge the price impact and want to proceed
              </span>
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
          onClick={handleChangeButton}
          disabled={isSwapping}
          style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Change
        </Button>
        <Button
          className={cn(
            // Disable button during quote loading or if high price impact not acknowledged
            !trade.quoteLoading && canProceed && (swapProgressState === "needs_approval" ||
            swapProgressState === "needs_signature" ||
            swapProgressState === "ready_to_swap")
              ? trade.priceImpactWarning?.severity === 'high'
                ? "text-red-500 border border-red-500 bg-red-500/10 hover:bg-red-500/20"
                : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              : "relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
          )}
          onClick={handleConfirmSwap}
          disabled={trade.quoteLoading || !canProceed || !(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")}
          aria-busy={trade.quoteLoading}
          style={trade.quoteLoading || !canProceed || !(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")
            ? { backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
          }
        >
          <span className={isSwapping ? "animate-pulse" : ""}>
            {trade.quoteLoading ? "Finalizing Quote..." :
              !canProceed ? "Acknowledge Impact" :
              swapProgressState === "needs_approval" || swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approve" :
              swapProgressState === "needs_signature" || swapProgressState === "signing_permit" ? "Sign" :
              trade.priceImpactWarning?.severity === 'high' ? "Swap Anyway" :
              "Confirm Swap"}
          </span>
        </Button>
      </div>
    </motion.div>
  );
} 