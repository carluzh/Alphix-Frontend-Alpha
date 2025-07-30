"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowRightIcon,
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
    (step === "transaction" && ["building_tx", "executing_swap", "waiting_confirmation"].includes(currentStep));

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
const getStepIcon = (swapProgressState: SwapProgressState, isSwapping: boolean) => {
    if (isSwapping) {
      // This logic seems to be for the main button's spinning icon, not the central display icon
      // The central display icon logic from SwapInterface was:
      // switch(swapProgressState) {
      //   case "needs_approval": case "approving": case "waiting_approval": return <CoinsIcon ... />;
      //   case "needs_signature": case "signing_permit": case "signature_complete": return <FileTextIcon ... />;
      //   case "building_tx": case "executing_swap": case "waiting_confirmation": return <WalletIcon ... />;
      //   default: return <FileTextIcon ... />;
      // }
      // For the large central icon, it should probably not spin unless the entire step is about active processing.
      // Let's refine based on the original logic for the central icon.
      if (swapProgressState === "approving" || swapProgressState === "waiting_approval" || swapProgressState === "signing_permit" || swapProgressState === "building_tx" || swapProgressState === "executing_swap" || swapProgressState === "waiting_confirmation") {
        return <RefreshCwIcon className="h-8 w-8 text-slate-50 dark:text-black animate-spin" />;
      }
    }
    switch(swapProgressState) {
      case "needs_approval":
      case "approving": // Keep CoinsIcon for these parent states if not spinning
      case "waiting_approval":
        return <CoinsIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
      case "needs_signature":
      case "signing_permit":
      case "signature_complete": // Includes signature_complete here
        return <FileTextIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
      case "ready_to_swap": // Explicitly for ready_to_swap, if it gets its own icon
      case "building_tx": // Keep WalletIcon for these parent states if not spinning
      case "executing_swap":
      case "waiting_confirmation":
        return <WalletIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
      default: // Fallback for init, checking_allowance, error, etc.
        return <FileTextIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
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
      <div className="mb-6 flex items-center justify-between bg-muted/10 rounded-lg p-4 hover:bg-muted/20 transition-colors">
        <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
          <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={40} height={40} className="rounded-full"/>
          <div className="text-left flex flex-col">
            <div className="font-medium flex items-baseline">
              {calculatedValues.fromTokenAmount === "< 0.001" ? (
                <span className="text-sm text-muted-foreground">{calculatedValues.fromTokenAmount}</span>
              ) : (
                <span>{calculatedValues.fromTokenAmount}</span>
              )}
              <span className="ml-1 text-sm text-muted-foreground">{displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
          </div>
        </Button>
        <ArrowRightIcon className="h-5 w-5 text-muted-foreground mx-2" />
        <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {calculatedValues.toTokenAmount === "< 0.001" ? (
                <span className="text-sm text-muted-foreground">{calculatedValues.toTokenAmount}</span>
              ) : (
                <span>{calculatedValues.toTokenAmount}</span>
              )}
              <span className="ml-1 text-sm text-muted-foreground">{displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={40} height={40} className="rounded-full"/>
        </Button>
      </div>
      <div className="rounded-lg border border-slate-300 dark:border-zinc-800 p-4 mb-6 space-y-3 text-sm">
        {renderStepIndicator("approval", swapProgressState, completedSteps)}
        {renderStepIndicator("signature", swapProgressState, completedSteps)}
        {renderStepIndicator("transaction", swapProgressState, completedSteps)}
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        <motion.div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 dark:bg-white"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {getStepIcon(swapProgressState, isSwapping)}
        </motion.div>
        <div className="text-center">
          <h3 className="text-lg font-medium">
            {isSwapping ? (
              swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approving" :
              swapProgressState === "signing_permit" ? "Signing" :
              swapProgressState === "executing_swap" || swapProgressState === "waiting_confirmation" ? "Swapping" :
              "Processing"
            ) : (
              "Confirm Swap"
            )}
          </h3>
          <p className="text-muted-foreground mt-1">{displayFromToken.symbol} for {displayToToken.symbol}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
          onClick={handleChangeButton}
          disabled={isSwapping}
          style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Change
        </Button>
        <Button
          className={isSwapping || swapProgressState === "init" || swapProgressState === "checking_allowance" 
            ? "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
            : "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
          }
          onClick={handleConfirmSwap}
          disabled={isSwapping || swapProgressState === "init" || swapProgressState === "checking_allowance"}
          style={(isSwapping || swapProgressState === "init" || swapProgressState === "checking_allowance") 
            ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } 
            : undefined
          }
        >
          {isSwapping ? (
            <span className="flex items-center gap-2">
              <RefreshCwIcon className="h-4 w-4 animate-spin" />
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