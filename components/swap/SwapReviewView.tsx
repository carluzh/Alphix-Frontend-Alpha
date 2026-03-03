"use client";

import React from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRightIcon,
  CoinsIcon,
  FileTextIcon,
  WalletIcon
} from "lucide-react";
import { TokenImage } from '@/components/ui/token-image';
import { Button } from "@/components/ui/button";
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

type StepKey = 'approval' | 'signature' | 'transaction';

// Determine which steps apply based on swap source
function getStepsForSource(source: string | undefined): StepKey[] {
  // Kyberswap: direct ERC20 approval to router, no Permit2 signature needed
  if (source === "kyberswap") return ['approval', 'transaction'];
  // Alphix: ERC20 approval to Permit2, then sign permit, then swap
  return ['approval', 'signature', 'transaction'];
}

// Helper function to render the step indicator with modern style matching AddLiquidityForm
const renderStepIndicator = (step: StepKey, currentStep: SwapProgressState, completed: SwapProgressState[], isKyberswap: boolean) => {
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
    <div key={step} className="flex items-center justify-between">
      <span className="text-muted-foreground">
        {step === "approval" && (isKyberswap ? "Token Approval" : "Token Approval")}
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

// Helper function for step icon
const getStepIcon = (step: StepKey, size: 'large' | 'small' = 'large') => {
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

// Helper function to get current step index within the given steps array
const getCurrentStepIndex = (swapProgressState: SwapProgressState, steps: StepKey[]): number => {
  if (["needs_approval", "approving", "waiting_approval", "approval_complete"].includes(swapProgressState)) {
    return steps.indexOf('approval');
  }
  if (["needs_signature", "signing_permit", "signature_complete"].includes(swapProgressState)) {
    const idx = steps.indexOf('signature');
    // If signature step doesn't exist (Kyberswap), fall through to transaction
    return idx >= 0 ? idx : steps.indexOf('transaction');
  }
  if (["ready_to_swap", "building_tx", "executing_swap", "waiting_confirmation", "complete"].includes(swapProgressState)) {
    return steps.indexOf('transaction');
  }
  return 0; // default
};

// Helper function to get step title
const getStepTitle = (step: StepKey): string => {
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

// Helper function to get step subtitle
const getStepSubtitle = (step: StepKey, displayFromToken: any, displayToToken: any, fromAmount: string): string => {
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
const isStepActive = (step: StepKey, swapProgressState: SwapProgressState): boolean => {
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
const isStepWaiting = (step: StepKey, swapProgressState: SwapProgressState): boolean => {
  switch(step) {
    case "approval":
      return swapProgressState === "waiting_approval";
    case "signature":
      return false;
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
  const isKyberswap = trade.source === "kyberswap";
  const steps = getStepsForSource(trade.source);

  return (
    <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div
        className="mb-6 flex items-center justify-between rounded-lg border border-primary p-4 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={handleChangeButton}
      >
        <div className="flex items-center gap-3">
          <TokenImage src={displayFromToken.icon} alt={displayFromToken.symbol} size={32} />
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
          <TokenImage src={displayToToken.icon} alt={displayToToken.symbol} size={32} />
        </div>
      </div>

      {/* Source badge for Kyberswap */}
      {isKyberswap && (
        <div className="flex items-center gap-2 mb-4 px-1">
          <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-purple-500/20 text-purple-400 uppercase">
            Via Kyberswap
          </span>
          <span className="text-xs text-muted-foreground">Aggregator route</span>
        </div>
      )}

      <div className="p-3 border border-dashed rounded-md bg-muted/10 mb-6">
        <p className="text-sm font-medium mb-3 text-foreground/80">Transaction Steps</p>
        <div className="space-y-1.5 text-xs">
          {steps.map(step => renderStepIndicator(step, swapProgressState, completedSteps, isKyberswap))}
        </div>
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        {/* Dynamic Step Display */}
        <div className="mb-4 flex items-center justify-center gap-8 w-full h-16">
          {steps.map((step, index) => {
            const currentStepIndex = getCurrentStepIndex(swapProgressState, steps);
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
              const currentStepIndex = getCurrentStepIndex(swapProgressState, steps);
              const currentStep = steps[Math.max(0, currentStepIndex)];
              return getStepTitle(currentStep);
            })()}
          </h3>
          <p className="text-muted-foreground mt-1">
            {(() => {
              const currentStepIndex = getCurrentStepIndex(swapProgressState, steps);
              const currentStep = steps[Math.max(0, currentStepIndex)];
              return getStepSubtitle(currentStep, displayFromToken, displayToToken, trade.calculatedValues.fromTokenAmount);
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
          style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Change
        </Button>
        <Button
          className={cn(
            !trade.quoteLoading && (swapProgressState === "needs_approval" ||
            swapProgressState === "needs_signature" ||
            swapProgressState === "ready_to_swap")
              ? "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              : "relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
          )}
          onClick={handleConfirmSwap}
          disabled={trade.quoteLoading || !(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")}
          aria-busy={trade.quoteLoading}
          style={trade.quoteLoading || !(swapProgressState === "needs_approval" || swapProgressState === "needs_signature" || swapProgressState === "ready_to_swap")
            ? { backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
          }
        >
          <span className={isSwapping ? "animate-pulse" : ""}>
            {trade.quoteLoading ? "Finalizing Quote..." :
              swapProgressState === "needs_approval" || swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approve" :
              swapProgressState === "needs_signature" || swapProgressState === "signing_permit" ? "Sign" :
              "Confirm Swap"}
          </span>
        </Button>
      </div>
    </motion.div>
  );
}
