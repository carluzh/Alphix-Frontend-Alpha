"use client";

/**
 * DecreaseLiquidityReview - Confirmation UI for decrease liquidity flow
 *
 * Refactored to use step-based executor pattern:
 * - Uses useLiquidityStepExecutor for transaction execution
 * - Uses ProgressIndicator for step visualization
 * - Matches the pattern from IncreaseLiquidityReview.tsx and ReviewExecuteModal.tsx
 *
 * Note: Decrease operations don't require approvals or permits,
 * so there's just a single transaction step.
 *
 * @see components/liquidity/wizard/ReviewExecuteModal.tsx
 * @see components/liquidity/increase/IncreaseLiquidityReview.tsx
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { ExternalLink as ExternalLinkIcon, AlertCircle } from "lucide-react";
import { IconBadgeCheck2 } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { getTokenIcon, formatCalculatedAmount } from "../liquidity-form-utils";
import { LiquidityDetailRows } from "../shared/LiquidityDetailRows";
import { LiquidityPositionInfo } from "../shared/LiquidityPositionInfo";
import { useDecreaseLiquidityContext, DecreaseLiquidityStep } from "./DecreaseLiquidityContext";
import { useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";

// Step executor and progress indicator
import {
  useLiquidityStepExecutor,
  generateLPTransactionSteps,
} from "@/lib/liquidity/transaction";
import { type TransactionStep } from "@/lib/liquidity/types";
import { ProgressIndicator } from "@/components/transactions";
import {
  type CurrentStepState,
  type TransactionStep as UITransactionStep,
  TransactionStepType as UIStepType,
} from "@/lib/transactions";

// Modal view types
type ModalView = "review" | "executing" | "success";

// Map executor step types to UI step types for ProgressIndicator
function mapExecutorStepsToUI(
  executorSteps: TransactionStep[],
  token0Symbol: string,
  token1Symbol: string,
  token0Icon?: string,
  token1Icon?: string
): UITransactionStep[] {
  return executorSteps.map((step): UITransactionStep => {
    switch (step.type) {
      case "DecreasePositionTransaction":
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
      default:
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
    }
  });
}

// Error callout component
function ErrorCallout({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  if (!error) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={onRetry}
          className="text-xs text-red-400 hover:text-red-300 underline mt-2"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

interface DecreaseLiquidityReviewProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function DecreaseLiquidityReview({ onClose, onSuccess }: DecreaseLiquidityReviewProps) {
  const { address } = useAccount();

  const { setStep, decreaseLiquidityState, derivedDecreaseInfo } = useDecreaseLiquidityContext();
  const {
    isLoading,
    error: contextError,
    token0USDPrice,
    token1USDPrice,
    fetchAndBuildContext,
    getWithdrawButtonText,
    clearError,
  } = useDecreaseLiquidityTxContext();

  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1 } = derivedDecreaseInfo;

  // Local state
  const [view, setView] = useState<ModalView>("review");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Computed values
  const amount0 = parseFloat(withdrawAmount0 || "0");
  const amount1 = parseFloat(withdrawAmount1 || "0");
  const usdValue0 = amount0 * token0USDPrice;
  const usdValue1 = amount1 * token1USDPrice;
  const totalUSDValue = usdValue0 + usdValue1;
  const error = localError || contextError;

  // Map executor steps to UI steps
  const uiSteps = useMemo(() => {
    return mapExecutorStepsToUI(
      executorSteps,
      position.token0.symbol,
      position.token1.symbol,
      getTokenIcon(position.token0.symbol),
      getTokenIcon(position.token1.symbol)
    );
  }, [executorSteps, position.token0.symbol, position.token1.symbol]);

  // Current step for ProgressIndicator
  const currentStep = useMemo((): CurrentStepState | undefined => {
    if (uiSteps.length === 0 || currentStepIndex >= uiSteps.length) return undefined;
    return { step: uiSteps[currentStepIndex], accepted: stepAccepted };
  }, [uiSteps, currentStepIndex, stepAccepted]);

  // Step executor - handles transaction execution
  const executor = useLiquidityStepExecutor({
    onSuccess: async (hash) => {
      setIsExecuting(false);
      setTxHash(hash || null);
      setView("success");
      setCurrentStepIndex(0);
      setStepAccepted(false);
    },
    onFailure: (err) => {
      setIsExecuting(false);
      const errorMessage = err?.message || "Transaction failed";
      const isUserRejection =
        errorMessage.toLowerCase().includes("user rejected") ||
        errorMessage.toLowerCase().includes("user denied");

      setView("review");
      setCurrentStepIndex(0);
      setStepAccepted(false);

      if (!isUserRejection) {
        setLocalError(errorMessage);
      }
    },
    onStepChange: (stepIndex, _step, accepted) => {
      setCurrentStepIndex(stepIndex);
      setStepAccepted(accepted);
    },
  });

  // Handle confirm - fetch context and execute
  const handleConfirm = useCallback(async () => {
    if (!address) return;

    setView("executing");
    setIsExecuting(true);
    setLocalError(null);

    try {
      // Build context from API
      const context = await fetchAndBuildContext();
      if (!context) {
        throw new Error("Failed to build transaction context");
      }

      // Generate steps for UI display
      const steps = generateLPTransactionSteps(context);
      setExecutorSteps(steps);

      // Start with first step
      if (steps.length > 0) {
        setCurrentStepIndex(0);
        setStepAccepted(false);
      }

      // Execute using step executor
      await executor.execute(context);
    } catch (err: any) {
      console.error("[DecreaseLiquidityReview] Transaction error:", err);
      setIsExecuting(false);
      setView("review");
      setLocalError(err?.message || "Transaction failed");
    }
  }, [address, fetchAndBuildContext, executor]);

  // Handle back
  const handleBack = useCallback(() => {
    if (!isExecuting) {
      setStep(DecreaseLiquidityStep.Input);
    }
  }, [isExecuting, setStep]);

  // Handle done
  const handleDone = useCallback(() => {
    onSuccess?.();
    onClose();
  }, [onSuccess, onClose]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setLocalError(null);
    clearError();
  }, [clearError]);

  // Reset state when view changes to review
  useEffect(() => {
    if (view === "review") {
      setExecutorSteps([]);
    }
  }, [view]);

  // Success view
  if (view === "success") {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <IconBadgeCheck2 className="h-6 w-6 text-green-500" />
          </div>
          <h3 className="text-lg font-medium">Liquidity Withdrawn!</h3>
          {txHash && (
            <a
              href={getExplorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline mt-1"
            >
              View on Explorer
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="rounded-lg border border-primary p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            {amount0 > 0 && (
              <div className="flex items-center gap-2">
                <Image
                  src={getTokenIcon(position.token0.symbol)}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-full"
                />
                <div>
                  <div className="font-medium text-sm">
                    {formatTokenDisplayAmount(amount0.toString(), position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCalculatedAmount(usdValue0)}
                  </div>
                </div>
              </div>
            )}
            {amount0 > 0 && amount1 > 0 && (
              <span className="text-muted-foreground">+</span>
            )}
            {amount1 > 0 && (
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="font-medium text-sm">
                    {formatTokenDisplayAmount(amount1.toString(), position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCalculatedAmount(usdValue1)}
                  </div>
                </div>
                <Image
                  src={getTokenIcon(position.token1.symbol)}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-full"
                />
              </div>
            )}
          </div>
        </div>

        <Button
          onClick={handleDone}
          className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
        >
          Done
        </Button>
      </div>
    );
  }

  // Review/executing view
  return (
    <div className="space-y-4">
      {/* Position Info */}
      <LiquidityPositionInfo
        position={{
          token0Symbol: position.token0.symbol,
          token1Symbol: position.token1.symbol,
          isInRange: position.isInRange,
        }}
        isMiniVersion
        showFeeTier={false}
      />

      {/* Amount Summary */}
      <LiquidityDetailRows
        token0Amount={withdrawAmount0}
        token0Symbol={position.token0.symbol}
        token1Amount={withdrawAmount1}
        token1Symbol={position.token1.symbol}
        token0USDValue={usdValue0}
        token1USDValue={usdValue1}
        totalValueUSD={totalUSDValue}
        showNetworkCost={false}
        title="Withdrawing from position"
      />

      {/* Progress Indicator (during execution) */}
      {view === "executing" && currentStep && uiSteps.length > 0 && (
        <ProgressIndicator steps={uiSteps} currentStep={currentStep} />
      )}

      {/* Error Display */}
      {error && (
        <ErrorCallout error={error} onRetry={handleRetry} />
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={isExecuting || isLoading}
          className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
          style={{
            backgroundImage: "url(/patterns/button-default.svg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          Back
        </Button>

        <Button
          onClick={handleConfirm}
          disabled={isExecuting || isLoading}
          className={cn(
            "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
            (isExecuting || isLoading) && "opacity-80"
          )}
        >
          <span className={(isExecuting || isLoading) ? "animate-pulse" : ""}>
            {isExecuting || isLoading ? "Processing..." : getWithdrawButtonText()}
          </span>
        </Button>
      </div>
    </div>
  );
}
