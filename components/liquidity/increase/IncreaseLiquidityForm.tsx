"use client";

/**
 * IncreaseLiquidityForm - Combined input and execution UI for add liquidity flow
 *
 * Features:
 * - Header with TokenStack + Range/Yield badges
 * - Token input fields with percentage buttons
 * - Position segment showing current/projected position
 * - Single "Review" button that starts transaction flow directly
 * - Progress indicator during execution
 * - Success state with done button
 *
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityForm.tsx
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { useAnimation } from "framer-motion";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useNetwork } from "@/lib/network-context";
import { toast } from "sonner";
import { formatCalculatedAmount, getTokenIcon } from "../liquidity-form-utils";
import { DepositInputForm, type PositionField } from "../shared/DepositInputForm";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import { useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { useIncreaseLiquidityTxContext } from "./IncreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";
import { getPoolById } from "@/lib/pools-config";
import Image from "next/image";

// Flow state tracking for permit recovery
import {
  getOrCreateFlowState,
  clearFlowState,
  clearCachedPermit,
} from "@/lib/permit-types";

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
// Modal view types (success is handled via toast + immediate close)
type ModalView = "input" | "executing";

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
      case "TokenApproval":
      case "TokenRevocation": {
        const tokenSymbol = (step as any).token?.symbol || token0Symbol;
        const tokenAddress = (step as any).token?.address || "";
        const isToken0 = tokenSymbol === token0Symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol,
          tokenAddress,
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }
      // Unified Yield approval - direct ERC20 to Hook
      case "UnifiedYieldApproval": {
        const uyStep = step as any;
        const isToken0 = uyStep.tokenSymbol === token0Symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: uyStep.tokenSymbol || token0Symbol,
          tokenAddress: uyStep.tokenAddress || "",
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }
      case "Permit2Signature":
        return {
          type: UIStepType.Permit2Signature,
        };
      case "IncreasePositionTransaction":
      case "IncreasePositionTransactionAsync":
      case "UnifiedYieldDeposit": // UY deposit maps to increase position UI
        return {
          type: UIStepType.IncreasePositionTransaction,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
      default:
        return {
          type: UIStepType.IncreasePositionTransaction,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
    }
  });
}

// Simple error callout component
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

interface IncreaseLiquidityFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

export function IncreaseLiquidityForm({ onClose, onSuccess }: IncreaseLiquidityFormProps) {
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  const { address } = useAccount();
  const { chainId } = useNetwork();

  const {
    increaseLiquidityState,
    derivedIncreaseLiquidityInfo,
    setAmount0,
    setAmount1,
    hasValidAmounts,
    isOverBalance0,
    isOverBalance1,
    isUnifiedYield,
  } = useIncreaseLiquidityContext();

  const {
    token0Balance,
    token1Balance,
    token0USDPrice,
    token1USDPrice,
    handlePercentage0,
    handlePercentage1,
    calculateDependentAmount,
    isCalculating,
    isLoading,
    error: contextError,
    fetchAndBuildContext,
    refetchBalances,
    clearError,
  } = useIncreaseLiquidityTxContext();

  const { position } = increaseLiquidityState;
  const { formattedAmounts } = derivedIncreaseLiquidityInfo;

  // Local state
  const [view, setView] = useState<ModalView>("input");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);
  const [flowId, setFlowId] = useState<string | undefined>(undefined);

  // Determine deposit disabled states based on position range
  const isOutOfRange = !position.isInRange;
  let deposit0Disabled = false;
  let deposit1Disabled = false;

  if (isOutOfRange) {
    const amt0 = parseFloat(position.token0?.amount || "0");
    const amt1 = parseFloat(position.token1?.amount || "0");
    if (amt0 > 0 && amt1 <= 0) {
      deposit1Disabled = true;
    } else if (amt1 > 0 && amt0 <= 0) {
      deposit0Disabled = true;
    }
  }

  // Computed values
  const amount0 = parseFloat(formattedAmounts?.TOKEN0 || "0");
  const amount1 = parseFloat(formattedAmounts?.TOKEN1 || "0");
  const usdValue0 = amount0 * token0USDPrice;
  const usdValue1 = amount1 * token1USDPrice;
  const error = localError || contextError;

  // Calculate position amounts (current + input for projected)
  const currentToken0Amount = parseFloat(position.token0.amount || "0");
  const currentToken1Amount = parseFloat(position.token1.amount || "0");
  const projectedToken0Amount = currentToken0Amount + amount0;
  const projectedToken1Amount = currentToken1Amount + amount1;

  // Show projected if user has entered any amounts
  const showProjected = amount0 > 0 || amount1 > 0;

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

  // Step executor
  const executor = useLiquidityStepExecutor({
    onSuccess: (hash) => {
      setIsExecuting(false);
      setCurrentStepIndex(0);
      setStepAccepted(false);
      refetchBalances();

      if (flowId) {
        clearFlowState(flowId);
      }
      if (address && chainId) {
        clearCachedPermit(address, chainId, position.token0.symbol, position.token1.symbol);
      }

      // Show success toast with explorer link
      if (hash) {
        toast.success("Liquidity added successfully!", {
          action: {
            label: "View",
            onClick: () => window.open(getExplorerTxUrl(hash), "_blank"),
          },
        });
      } else {
        toast.success("Liquidity added successfully!");
      }

      // Trigger refetch and close modal
      onSuccess?.();
      onClose?.();
    },
    onFailure: (err) => {
      setIsExecuting(false);
      const errorMessage = err?.message || "Transaction failed";
      const isUserRejection =
        errorMessage.toLowerCase().includes("user rejected") ||
        errorMessage.toLowerCase().includes("user denied");

      setView("input");
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

  // Handle user input
  const handleUserInput = (field: PositionField, value: string) => {
    if (field === "TOKEN0") {
      setAmount0(value);
    } else {
      setAmount1(value);
    }
  };

  // Handle Review button click - starts transaction flow
  // Uses unified executor for both V4 and Unified Yield positions
  const handleReview = useCallback(async () => {
    if (!address || !hasValidAmounts) return;

    setView("executing");
    setIsExecuting(true);
    setLocalError(null);

    // V4 uses permit flow state tracking
    if (!isUnifiedYield) {
      const flow = getOrCreateFlowState(
        address,
        chainId || 0,
        position.token0.symbol,
        position.token1.symbol,
        position.tickLower,
        position.tickUpper
      );
      setFlowId(flow.flowId);
    }

    try {
      // Unified execution path - works for both V4 and Unified Yield
      const context = await fetchAndBuildContext();
      if (!context) {
        throw new Error("Failed to build transaction context");
      }

      const steps = generateLPTransactionSteps(context);
      setExecutorSteps(steps);

      if (steps.length > 0) {
        setCurrentStepIndex(0);
        setStepAccepted(false);
      }

      await executor.execute(context);
    } catch (err: any) {
      console.error("[IncreaseLiquidityForm] Transaction error:", err);
      setIsExecuting(false);
      setView("input");
      setLocalError(err?.message || "Transaction failed");
    }
  }, [address, chainId, position, hasValidAmounts, fetchAndBuildContext, executor, isUnifiedYield]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setLocalError(null);
    clearError();
  }, [clearError]);

  // Reset state when view changes to input
  useEffect(() => {
    if (view === "input") {
      setExecutorSteps([]);
    }
  }, [view]);

  // Button state
  const isDisabled =
    !hasValidAmounts ||
    isOverBalance0 ||
    isOverBalance1 ||
    isCalculating ||
    isLoading ||
    isExecuting;

  const buttonText = isOverBalance0 || isOverBalance1
    ? "Insufficient Balance"
    : "Add Liquidity";

  // Input/Executing view
  return (
    <div className="space-y-4">
      {/* Header - Token pair with badges */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {/* Token symbols */}
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-white">
              {position.token0.symbol}
            </span>
            <span className="text-2xl font-semibold text-muted-foreground">/</span>
            <span className="text-2xl font-semibold text-white">
              {position.token1.symbol}
            </span>
          </div>
          {/* Range indicator + pool type badges */}
          <div className="flex items-center gap-2">
            {/* Range badge */}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  position.isInRange ? "bg-green-500" : "bg-red-500"
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  position.isInRange ? "text-green-500" : "text-red-500"
                )}
              >
                {position.isInRange ? "In Range" : "Out of Range"}
              </span>
            </div>
            {/* Pool type badge */}
            {position.poolId && (() => {
              const poolConfig = getPoolById(position.poolId);
              const isUnifiedYield = poolConfig?.rehypoRange !== undefined;
              return isUnifiedYield ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
                >
                  Unified Yield
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground">
                  Custom
                </span>
              );
            })()}
          </div>
        </div>
        {/* Double token logo */}
        <div className="flex items-center -space-x-2">
          <Image
            src={getTokenIcon(position.token0.symbol)}
            alt=""
            width={36}
            height={36}
            className="rounded-full ring-2 ring-container"
          />
          <Image
            src={getTokenIcon(position.token1.symbol)}
            alt=""
            width={36}
            height={36}
            className="rounded-full ring-2 ring-container"
          />
        </div>
      </div>

      {/* Deposit Input Form */}
      <DepositInputForm
        token0Symbol={position.token0.symbol}
        token1Symbol={position.token1.symbol}
        formattedAmounts={formattedAmounts}
        currencyBalances={{
          TOKEN0: token0Balance,
          TOKEN1: token1Balance,
        }}
        onUserInput={handleUserInput}
        onCalculateDependentAmount={calculateDependentAmount}
        deposit0Disabled={deposit0Disabled}
        deposit1Disabled={deposit1Disabled}
        token0USDPrice={token0USDPrice}
        token1USDPrice={token1USDPrice}
        isAmount0OverBalance={isOverBalance0}
        isAmount1OverBalance={isOverBalance1}
        wiggleControls0={wiggleControls0}
        wiggleControls1={wiggleControls1}
        onToken0PercentageClick={handlePercentage0}
        onToken1PercentageClick={handlePercentage1}
        formatUsdAmount={formatCalculatedAmount}
        inputLabel="Add"
      />

      {/* Position Segment */}
      <PositionAmountsDisplay
        token0={{
          symbol: position.token0.symbol,
          amount: showProjected ? projectedToken0Amount.toString() : position.token0.amount,
        }}
        token1={{
          symbol: position.token1.symbol,
          amount: showProjected ? projectedToken1Amount.toString() : position.token1.amount,
        }}
        title="Position"
      />

      {/* Progress Indicator (during execution) */}
      {view === "executing" && currentStep && uiSteps.length > 0 && (
        <ProgressIndicator steps={uiSteps} currentStep={currentStep} />
      )}

      {/* Error Display */}
      {error && (
        <ErrorCallout
          error={error}
          onRetry={handleRetry}
        />
      )}

      {/* Review Button */}
      <Button
        onClick={handleReview}
        disabled={isDisabled}
        className={cn(
          "w-full",
          isDisabled
            ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75"
            : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
        )}
        style={
          isDisabled && !isExecuting
            ? {
                backgroundImage: "url(/patterns/button-wide.svg)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <span className={(isCalculating || isExecuting) ? "animate-pulse" : ""}>
          {buttonText}
        </span>
      </Button>
    </div>
  );
}
