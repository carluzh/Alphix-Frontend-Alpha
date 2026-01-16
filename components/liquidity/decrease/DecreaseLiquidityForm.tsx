"use client";

/**
 * DecreaseLiquidityForm - Combined input and execution UI for withdraw liquidity flow
 *
 * Uniswap-style percentage-only UI:
 * - Large percentage display (70px font, centered)
 * - Quick-select buttons (25%, 50%, 75%, MAX) styled as pills
 * - Shows "You will receive" display with token amounts
 * - Progress indicator during execution
 *
 * @see interface/apps/web/src/pages/RemoveLiquidity/RemoveLiquidityForm.tsx
 */

import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from "react";
import { AlertCircle } from "lucide-react";
import Image from "next/image";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { formatCalculatedAmount, getTokenIcon } from "../liquidity-form-utils";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import { useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";
import { useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";
import { getPoolById } from "@/lib/pools-config";

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
// For decrease, only show tokens that are actually being withdrawn (handles OOR positions)
function mapExecutorStepsToUI(
  executorSteps: TransactionStep[],
  token0Symbol: string,
  token1Symbol: string,
  token0Icon?: string,
  token1Icon?: string,
  withdrawAmount0?: string,
  withdrawAmount1?: string,
): UITransactionStep[] {
  // Determine which tokens are actually being withdrawn
  const hasToken0 = parseFloat(withdrawAmount0 || "0") > 0;
  const hasToken1 = parseFloat(withdrawAmount1 || "0") > 0;

  return executorSteps.map((step): UITransactionStep => {
    switch (step.type) {
      case "DecreasePositionTransaction":
        // Only include tokens that have non-zero withdraw amounts
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol: hasToken0 ? token0Symbol : undefined,
          token1Symbol: hasToken1 ? token1Symbol : undefined,
          token0Icon: hasToken0 ? token0Icon : undefined,
          token1Icon: hasToken1 ? token1Icon : undefined,
        } as UITransactionStep;
      default:
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol: hasToken0 ? token0Symbol : undefined,
          token1Symbol: hasToken1 ? token1Symbol : undefined,
          token0Icon: hasToken0 ? token0Icon : undefined,
          token1Icon: hasToken1 ? token1Icon : undefined,
        } as UITransactionStep;
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

// Percentage options for quick-select buttons
const PERCENTAGE_OPTIONS = [25, 50, 75, 100];

interface DecreaseLiquidityFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

export function DecreaseLiquidityForm({ onClose, onSuccess }: DecreaseLiquidityFormProps) {
  const { address } = useAccount();

  const {
    decreaseLiquidityState,
    derivedDecreaseInfo,
    setWithdrawAmount0,
    setWithdrawAmount1,
    setIsFullWithdraw,
    hasValidAmounts,
  } = useDecreaseLiquidityContext();

  const {
    isLoading,
    error: contextError,
    token0USDPrice,
    token1USDPrice,
    fetchAndBuildContext,
    clearError,
  } = useDecreaseLiquidityTxContext();

  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1, isCalculating } = derivedDecreaseInfo;

  // Local state
  const [view, setView] = useState<ModalView>("input");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);
  const [percent, setPercent] = useState<number>(0);
  const [percentStr, setPercentStr] = useState<string>(""); // String value for input (Uniswap pattern)

  // Dynamic width measurement for percentage input (Uniswap pattern)
  const hiddenSpanRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState<number>(0);

  // Measure hidden span width on percentStr change
  useLayoutEffect(() => {
    if (hiddenSpanRef.current) {
      const width = hiddenSpanRef.current.offsetWidth;
      setInputWidth(width > 0 ? width + 1 : 0); // +1 like Uniswap
    }
  }, [percentStr]);

  // Position balances
  const positionBalance0 = parseFloat(position.token0.amount || "0");
  const positionBalance1 = parseFloat(position.token1.amount || "0");

  // Computed amounts based on percentage
  const amount0 = (positionBalance0 * percent) / 100;
  const amount1 = (positionBalance1 * percent) / 100;
  const usdValue0 = amount0 * token0USDPrice;
  const usdValue1 = amount1 * token1USDPrice;
  const totalUsdValue = usdValue0 + usdValue1;
  const error = localError || contextError;

  // Calculate position amounts (current - withdraw for projected)
  const projectedToken0Amount = Math.max(0, positionBalance0 - amount0);
  const projectedToken1Amount = Math.max(0, positionBalance1 - amount1);

  // Show projected if user has selected any percentage
  const showProjected = percent > 0;

  // Handle percentage selection (from buttons)
  const handlePercentageSelect = useCallback((selectedPercent: number) => {
    setPercent(selectedPercent);
    setPercentStr(selectedPercent.toString()); // Sync string value

    // Calculate and set withdraw amounts based on percentage
    const calcAmount0 = (positionBalance0 * selectedPercent) / 100;
    const calcAmount1 = (positionBalance1 * selectedPercent) / 100;

    setWithdrawAmount0(calcAmount0.toString());
    setWithdrawAmount1(calcAmount1.toString());
    setIsFullWithdraw(selectedPercent >= 99);
  }, [positionBalance0, positionBalance1, setWithdrawAmount0, setWithdrawAmount1, setIsFullWithdraw]);

  // Map executor steps to UI steps (pass withdraw amounts to show correct tokens for OOR)
  const uiSteps = useMemo(() => {
    return mapExecutorStepsToUI(
      executorSteps,
      position.token0.symbol,
      position.token1.symbol,
      getTokenIcon(position.token0.symbol),
      getTokenIcon(position.token1.symbol),
      amount0.toString(),
      amount1.toString(),
    );
  }, [executorSteps, position.token0.symbol, position.token1.symbol, amount0, amount1]);

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

      // Show success toast with explorer link
      if (hash) {
        toast.success("Liquidity withdrawn successfully!", {
          action: {
            label: "View",
            onClick: () => window.open(getExplorerTxUrl(hash), "_blank"),
          },
        });
      } else {
        toast.success("Liquidity withdrawn successfully!");
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

  // Handle Review button click - starts transaction flow
  const handleReview = useCallback(async () => {
    if (!address || !hasValidAmounts) return;

    setView("executing");
    setIsExecuting(true);
    setLocalError(null);

    try {
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
      console.error("[DecreaseLiquidityForm] Transaction error:", err);
      setIsExecuting(false);
      setView("input");
      setLocalError(err?.message || "Transaction failed");
    }
  }, [address, hasValidAmounts, fetchAndBuildContext, executor]);

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
    percent === 0 ||
    isLoading ||
    isExecuting;

  const buttonText = percent === 0
    ? "Select amount"
    : "Withdraw";

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

      {/* Percentage Selector - Uniswap style */}
      <div className="rounded-xl border border-sidebar-border/60 bg-surface overflow-hidden">
        {/* Large Percentage Input */}
        <div className="px-4 pt-6 pb-4">
          {/* Uniswap NumericalInputWrapper pattern */}
          <div className="relative flex items-center justify-center w-full">
            <div className="relative max-w-full" style={{ width: "max-content" }}>
              {/* Input */}
              <input
                type="text"
                inputMode="numeric"
                value={percentStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  if (val === "" || (parseInt(val, 10) <= 100)) {
                    setPercentStr(val);
                    const num = val === "" ? 0 : parseInt(val, 10);
                    if (num === 0) {
                      setPercent(0);
                      setWithdrawAmount0("0");
                      setWithdrawAmount1("0");
                      setIsFullWithdraw(false);
                    } else {
                      handlePercentageSelect(num);
                    }
                  }
                }}
                placeholder="0"
                maxLength={3}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="text-left bg-transparent border-none outline-none focus:outline-none text-foreground placeholder:text-muted-foreground/50"
                style={{
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: "70px",
                  fontWeight: 500,
                  lineHeight: "60px",
                  width: inputWidth > 0 ? `${inputWidth}px` : "43px",
                  maxHeight: "84px",
                  maxWidth: "100%",
                }}
              />
              {/* % symbol */}
              <span
                className={cn(
                  "select-none",
                  !percentStr ? "text-muted-foreground/50" : "text-foreground"
                )}
                style={{
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: "70px",
                  fontWeight: 500,
                  lineHeight: "60px",
                }}
              >
                %
              </span>
              {/* Hidden mimic for width measurement */}
              <span
                ref={hiddenSpanRef}
                aria-hidden="true"
                className="absolute invisible bottom-0 right-0"
                style={{
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize: "70px",
                  fontWeight: 500,
                  lineHeight: "60px",
                  textAlign: "left",
                }}
              >
                {percentStr || "0"}
              </span>
            </div>
          </div>

          {/* Percentage Buttons */}
          <div className="flex gap-2 justify-center mt-6">
            {PERCENTAGE_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => handlePercentageSelect(option)}
                disabled={isLoading || isExecuting}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all border",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  percent === option
                    ? "bg-button-primary text-sidebar-primary border-sidebar-primary"
                    : "bg-surface border-sidebar-border/60 text-muted-foreground hover:bg-muted/40 hover:border-sidebar-border hover:text-foreground"
                )}
              >
                {option === 100 ? "Max" : `${option}%`}
              </button>
            ))}
          </div>
        </div>

        {/* You Will Receive - animated */}
        <AnimatePresence>
          {percent > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              {/* Divider */}
              <div className="h-px bg-sidebar-border/60" />

              {/* Content - matches PositionAmountsDisplay styling */}
              <div className="p-3">
                <h4 className="text-sm font-medium text-muted-foreground mb-2">You will receive</h4>
                <div className="rounded-lg border border-sidebar-border/60 bg-surface p-3 space-y-2">
                  {/* Token 0 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image
                        src={getTokenIcon(position.token0.symbol)}
                        alt={position.token0.symbol}
                        width={20}
                        height={20}
                        className="rounded-full"
                      />
                      <span className="text-sm font-medium">{position.token0.symbol}</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium tabular-nums",
                      amount0 === 0 && "text-muted-foreground"
                    )}>
                      {formatTokenDisplayAmount(amount0.toString(), position.token0.symbol as TokenSymbol)}
                    </span>
                  </div>
                  {/* Token 1 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image
                        src={getTokenIcon(position.token1.symbol)}
                        alt={position.token1.symbol}
                        width={20}
                        height={20}
                        className="rounded-full"
                      />
                      <span className="text-sm font-medium">{position.token1.symbol}</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium tabular-nums",
                      amount1 === 0 && "text-muted-foreground"
                    )}>
                      {formatTokenDisplayAmount(amount1.toString(), position.token1.symbol as TokenSymbol)}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Position Segment - shows remaining after withdraw */}
      <PositionAmountsDisplay
        token0={{
          symbol: position.token0.symbol,
          amount: showProjected ? projectedToken0Amount.toString() : position.token0.amount,
        }}
        token1={{
          symbol: position.token1.symbol,
          amount: showProjected ? projectedToken1Amount.toString() : position.token1.amount,
        }}
        title={showProjected ? "Remaining Position" : "Current Position"}
      />

      {/* Progress Indicator (during execution) */}
      {view === "executing" && currentStep && uiSteps.length > 0 && (
        <ProgressIndicator steps={uiSteps} currentStep={currentStep} />
      )}

      {/* Error Display */}
      {error && (
        <ErrorCallout error={error} onRetry={handleRetry} />
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
