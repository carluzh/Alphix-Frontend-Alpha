"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ChevronRightIcon,
  CheckIcon,
  ActivityIcon,
  MinusIcon,
  RefreshCwIcon,
  CoinsIcon,
  FileTextIcon,
  WalletIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Token, SwapProgressState } from './swap-interface'; // Removed FeeDetail and SwapTxInfo as they are not directly used in this simplified props interface yet
import { formatTokenAmount } from "@/lib/utils";

// Forward declare props that might come from the main interface or be defined here
interface SwapReviewViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  calculatedValues: {
    fromTokenAmount: string;
    fromTokenValue: string;
    toTokenAmount: string;
    toTokenValue: string;
  };
  handleChangeButton: () => void;
  handleConfirmSwap: () => void;
  swapProgressState: SwapProgressState;
  completedSteps: SwapProgressState[];
  isSwapping: boolean;
  // getStepIcon and renderStepIndicator might be moved here or passed as props
}

// Helper function to render the step indicator (can be moved from SwapInterface or passed as prop)
const renderStepIndicator = (step: string, currentStep: SwapProgressState, completed: SwapProgressState[]) => {
  const isActive =
    (step === "approval" && ["needs_approval", "approving", "waiting_approval"].includes(currentStep)) ||
    (step === "signature" && ["needs_signature", "signing_permit"].includes(currentStep)) ||
    (step === "transaction" && ["ready_to_swap", "building_tx", "executing_swap", "waiting_confirmation"].includes(currentStep));

  const isCompleted =
    (step === "approval" && completed.includes("approval_complete")) ||
    (step === "signature" && completed.includes("signature_complete")) ||
    (step === "transaction" && completed.includes("complete"));

  return (
    <div className="flex items-center justify-between">
      <span className={isActive ? "font-medium" : isCompleted ? "text-foreground" : "text-muted-foreground"}>
        {step === "approval" && "Token Approval"}
        {step === "signature" && "Sign Token Allowance"}
        {step === "transaction" && "Send Swap Transaction"}
      </span>
      <span>
        {isCompleted ? (
          <CheckIcon className="h-4 w-4 text-foreground" />
        ) : isActive ? (
          <ActivityIcon className="h-4 w-4 animate-pulse" />
        ) : (
          <MinusIcon className="h-4 w-4 text-muted-foreground" />
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
  calculatedValues,
  handleChangeButton,
  handleConfirmSwap,
  swapProgressState,
  completedSteps,
  isSwapping
}: SwapReviewViewProps) {
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
              {calculatedValues.fromTokenAmount === "< 0.001" ? (
                <span className="text-xs text-muted-foreground">{calculatedValues.fromTokenAmount}</span>
              ) : (
                (() => {
                  const formatted = formatTokenAmount(calculatedValues.fromTokenAmount);
                  const hasEllipsis = formatted.endsWith('...');
                  const main = hasEllipsis ? formatted.slice(0, -3) : formatted;
                  return (
                    <span className="text-sm">
                      {main}
                      {hasEllipsis && <span className="text-muted-foreground">...</span>}
                    </span>
                  );
                })()
              )}
              <span className="ml-1 text-xs text-muted-foreground">{displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
          </div>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {calculatedValues.toTokenAmount === "< 0.001" ? (
                <span className="text-xs text-muted-foreground">{calculatedValues.toTokenAmount}</span>
              ) : (
                (() => {
                  const formatted = formatTokenAmount(calculatedValues.toTokenAmount);
                  const hasEllipsis = formatted.endsWith('...');
                  const main = hasEllipsis ? formatted.slice(0, -3) : formatted;
                  return (
                    <span className="text-sm">
                      {main}
                      {hasEllipsis && <span className="text-muted-foreground">...</span>}
                    </span>
                  );
                })()
              )}
              <span className="ml-1 text-xs text-muted-foreground">{displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={32} height={32} className="rounded-full"/>
        </div>
      </div>
      <div className="rounded-lg border border-dashed border-primary p-4 mb-6 space-y-3 text-sm">
        {renderStepIndicator("approval", swapProgressState, completedSteps)}
        {renderStepIndicator("signature", swapProgressState, completedSteps)}
        {renderStepIndicator("transaction", swapProgressState, completedSteps)}
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
                  backgroundImage: 'url(/pattern_wide.svg)',
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
              return getStepSubtitle(currentStep, displayFromToken, displayToToken, calculatedValues.fromTokenAmount);
            })()}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
          onClick={handleChangeButton}
          disabled={isSwapping}
          style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Change
        </Button>
        <Button
          className={
            swapProgressState === "needs_approval" ||
            swapProgressState === "needs_signature" ||
            swapProgressState === "ready_to_swap"
              ? "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              : "relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
          }
          onClick={handleConfirmSwap}
          disabled={!(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")}
          style={!(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")
            ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
          }
        >
          {isSwapping ? (
            <span className="animate-pulse">
              {swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approving..." :
                swapProgressState === "signing_permit" ? "Signing..." :
                swapProgressState === "executing_swap" || swapProgressState === "waiting_confirmation" ? "Swapping..." :
                "Processing..."}
            </span>
          ) : (
            swapProgressState === "needs_approval" ? "Approve" :
            swapProgressState === "needs_signature" ? "Sign" :
            swapProgressState === "ready_to_swap" ? "Confirm Swap" :
            "Confirm Swap" // Default/Fallback
          )}
        </Button>
      </div>
    </motion.div>
  );
} 