"use client";

/**
 * CollectFeesModal - Modal for collecting unclaimed fees from a position
 *
 * Uses Uniswap's step-based executor pattern for transaction execution.
 * @see interface/apps/web/src/components/Liquidity/ClaimFeeModal.tsx
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import Image from "next/image";
import { AlertCircle } from "lucide-react";
import { IconXmark } from "nucleo-micro-bold-essential";
import { useAccount } from "wagmi";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import { getTokenIcon } from "../liquidity-form-utils";
import { useUSDCPriceRaw } from "@/lib/uniswap/hooks/useUSDCPrice";
import { Token } from "@uniswap/sdk-core";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";
import { getToken, getPoolById } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import type { Address } from "viem";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";

// Uniswap step-based executor
import {
  useLiquidityStepExecutor,
  buildCollectFeesContext,
  generateLPTransactionSteps,
  type MintTxApiResponse,
} from "@/lib/liquidity/transaction";
import {
  LiquidityTransactionType,
  type TransactionStep,
  type ValidatedLiquidityTxContext,
} from "@/lib/liquidity/types";

// Progress indicator
import { ProgressIndicator } from "@/components/transactions";
import {
  type CurrentStepState,
  type TransactionStep as UITransactionStep,
  TransactionStepType as UIStepType,
} from "@/lib/transactions";

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
      case "CollectFeesTransaction":
        return {
          type: UIStepType.CollectFeesTransactionStep,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
      default:
        return {
          type: UIStepType.CollectFeesTransactionStep,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
    }
  });
}

// Error callout component - inline error display like Uniswap
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

// Modal view types
type ModalView = "review" | "executing";

interface CollectFeesModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CollectFeesModal({ position, isOpen, onClose, onSuccess }: CollectFeesModalProps) {
  const { address } = useAccount();
  const { chainId, networkMode } = useNetwork();

  // Modal state
  const [view, setView] = useState<ModalView>("review");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);

  // Get token configs
  const token0Config = getToken(position.token0.symbol as TokenSymbol, networkMode);
  const token1Config = getToken(position.token1.symbol as TokenSymbol, networkMode);

  // Create Token objects for USD price hooks
  const token0 = useMemo(() => {
    if (!token0Config || !chainId) return null;
    return new Token(chainId, token0Config.address, token0Config.decimals, token0Config.symbol);
  }, [token0Config, chainId]);

  const token1 = useMemo(() => {
    if (!token1Config || !chainId) return null;
    return new Token(chainId, token1Config.address, token1Config.decimals, token1Config.symbol);
  }, [token1Config, chainId]);

  // Get USD prices
  const { price: token0USDPrice } = useUSDCPriceRaw(token0 ?? undefined);
  const { price: token1USDPrice } = useUSDCPriceRaw(token1 ?? undefined);

  // Calculate fee values
  const fee0 = parseFloat(position.token0UncollectedFees || "0");
  const fee1 = parseFloat(position.token1UncollectedFees || "0");
  const usdFee0 = fee0 * (token0USDPrice || 0);
  const usdFee1 = fee1 * (token1USDPrice || 0);
  const totalFeesUSD = usdFee0 + usdFee1;

  const hasFees = fee0 > 0 || fee1 > 0;

  // Map executor steps to UI steps for ProgressIndicator
  const uiSteps = useMemo(() => {
    return mapExecutorStepsToUI(
      executorSteps,
      position.token0.symbol,
      position.token1.symbol,
      token0Config?.icon,
      token1Config?.icon
    );
  }, [executorSteps, position.token0.symbol, position.token1.symbol, token0Config?.icon, token1Config?.icon]);

  // Compute currentStep for ProgressIndicator
  const currentStep = useMemo((): CurrentStepState | undefined => {
    if (uiSteps.length === 0 || currentStepIndex >= uiSteps.length) return undefined;
    return { step: uiSteps[currentStepIndex], accepted: stepAccepted };
  }, [uiSteps, currentStepIndex, stepAccepted]);

  // Uniswap step-based executor
  const executor = useLiquidityStepExecutor({
    onSuccess: async () => {
      setIsExecuting(false);
      onSuccess?.();
      onClose();
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
        setError(errorMessage);
      }
    },
    onStepChange: (stepIndex, _step, accepted) => {
      setCurrentStepIndex(stepIndex);
      setStepAccepted(accepted);
    },
  });

  // Fetch API data and build context for step executor
  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!address || !chainId || !token0Config || !token1Config) return null;

    // Call API to prepare collect transaction
    const response = await fetch("/api/liquidity/prepare-collect-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress: address,
        tokenId: position.positionId,
        chainId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || "Failed to prepare collect transaction");
    }

    const txData = await response.json();

    // Build API response format for buildCollectFeesContext
    const apiResponse: MintTxApiResponse = {
      needsApproval: false,
      create: {
        to: txData.to,
        data: txData.data,
        value: txData.value || "0",
        chainId,
      },
    };

    // Convert display amounts to raw amounts (wei) using consolidated helper
    // safeParseUnits handles edge cases: scientific notation, commas, "< 0.0001" format
    const rawAmount0 = safeParseUnits(
      position.token0UncollectedFees || "0",
      token0Config.decimals
    ).toString();
    const rawAmount1 = safeParseUnits(
      position.token1UncollectedFees || "0",
      token1Config.decimals
    ).toString();

    // Build context using the shared builder
    const context = buildCollectFeesContext({
      type: LiquidityTransactionType.Collect,
      apiResponse,
      token0: {
        address: token0Config.address as Address,
        symbol: token0Config.symbol,
        decimals: token0Config.decimals,
        chainId,
      },
      token1: {
        address: token1Config.address as Address,
        symbol: token1Config.symbol,
        decimals: token1Config.decimals,
        chainId,
      },
      amount0: rawAmount0,
      amount1: rawAmount1,
      chainId,
    });

    return context as ValidatedLiquidityTxContext;
  }, [address, chainId, position.positionId, position.token0UncollectedFees, position.token1UncollectedFees, token0Config, token1Config]);

  // Handle confirm - use Uniswap step executor
  const handleConfirm = useCallback(async () => {
    if (!address || !hasFees) return;

    setView("executing");
    setIsExecuting(true);
    setError(null);

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

      // Execute using Uniswap step executor
      await executor.execute(context);
    } catch (err: any) {
      console.error("[CollectFeesModal] Transaction error:", err);
      setIsExecuting(false);
      setView("review");
      setError(err?.message || "Transaction failed");
    }
  }, [address, hasFees, fetchAndBuildContext, executor]);

  // Clear error and retry
  const handleRetry = useCallback(() => {
    setError(null);
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isExecuting) {
      setError(null);
      setView("review");
      setExecutorSteps([]);
      setCurrentStepIndex(0);
      setStepAccepted(false);
      onClose();
    }
  }, [isExecuting, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setView("review");
      setCurrentStepIndex(0);
      setStepAccepted(false);
      setExecutorSteps([]);
      setIsExecuting(false);
      setError(null);
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
          className="sm:max-w-[420px] bg-container border-sidebar-border p-0 gap-0 [&>button]:hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
        {/* Review/Executing View */}
        {(view === "review" || view === "executing") && (
          <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-base font-medium text-muted-foreground">
                {view === "executing" ? "Collecting fees" : "Collect Fees"}
              </span>
              <button
                onClick={handleClose}
                disabled={isExecuting}
                className="text-muted-foreground hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconXmark className="w-5 h-5" />
              </button>
            </div>

            {/* Token Pair Section */}
            <div className="px-4 py-3">
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
            </div>

            {/* Collecting Section */}
            <div className="px-4 py-3 mt-2">
              <span className="text-sm text-muted-foreground mb-3 block">You Will Receive</span>
              <div className="flex flex-col gap-4">
                {fee0 > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xl font-semibold text-white">
                        {formatTokenDisplayAmount(position.token0UncollectedFees || "0", position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                      </span>
                      <span className="text-sm text-muted-foreground">{formatUSD(usdFee0)}</span>
                    </div>
                    <Image
                      src={getTokenIcon(position.token0.symbol)}
                      alt={position.token0.symbol}
                      width={36}
                      height={36}
                      className="rounded-full"
                    />
                  </div>
                )}
                {fee1 > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xl font-semibold text-white">
                        {formatTokenDisplayAmount(position.token1UncollectedFees || "0", position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                      </span>
                      <span className="text-sm text-muted-foreground">{formatUSD(usdFee1)}</span>
                    </div>
                    <Image
                      src={getTokenIcon(position.token1.symbol)}
                      alt={position.token1.symbol}
                      width={36}
                      height={36}
                      className="rounded-full"
                    />
                  </div>
                )}
              </div>

              {/* Total Value */}
              <div className="mt-4 pt-4 border-t border-sidebar-border/60 flex justify-between">
                <span className="text-sm text-muted-foreground">Total Value</span>
                <span className="font-medium">{formatUSD(totalFeesUSD)}</span>
              </div>
            </div>

            {/* Error Callout - inline like Uniswap */}
            {error && (
              <div className="px-4 pb-2">
                <ErrorCallout error={error} onRetry={handleRetry} />
              </div>
            )}

            {/* No Fees Message */}
            {!hasFees && view === "review" && (
              <div className="px-4 pb-4">
                <div className="rounded-lg bg-muted/30 p-4 text-center">
                  <p className="text-muted-foreground">No fees to collect</p>
                </div>
              </div>
            )}

            {/* Bottom Section: Button OR Progress Indicator */}
            <div className="p-4 pt-2">
              {view === "executing" && currentStep && uiSteps.length > 0 ? (
                <ProgressIndicator steps={uiSteps} currentStep={currentStep} />
              ) : (
                <Button
                  onClick={handleConfirm}
                  disabled={isExecuting || !hasFees}
                  className={cn(
                    "w-full",
                    !hasFees
                      ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75"
                      : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
                    isExecuting && "opacity-80"
                  )}
                  style={
                    !hasFees
                      ? {
                          backgroundImage: "url(/patterns/button-wide.svg)",
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  <span className={isExecuting ? "animate-pulse" : ""}>
                    Collect Fees
                  </span>
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CollectFeesModal;
