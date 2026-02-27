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
import { AlertCircle, RefreshCw, Info } from "lucide-react";
import { useAnimation } from "framer-motion";
import { useAccount, usePublicClient } from "wagmi";
import { type Address } from "viem";

const ERC20_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useNetwork } from "@/lib/network-context";
import { toast } from "sonner";
import { formatCalculatedAmount, getTokenIcon } from "../liquidity-form-utils";
import { DepositInputForm, type PositionField } from "../shared/DepositInputForm";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import { TokenInputCard } from "../TokenInputCard";
import { DepositModeToggle } from "../shared/DepositModeToggle";
import { useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { useIncreaseLiquidityTxContext } from "./IncreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";
import { getPoolById, getTokenDefinitions } from "@/lib/pools-config";
import Image from "next/image";

// Zap utilities
import { generateZapSteps, isPreviewFresh } from "@/lib/liquidity/zap";
import type { ZapToken } from "@/lib/liquidity/zap";
import { getStoredUserSettings } from "@/hooks/useUserSettings";

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
      case "ZapDynamicDeposit": // Zap deposit step
        return {
          type: UIStepType.IncreasePositionTransaction,
          token0Symbol,
          token1Symbol,
          token0Icon,
          token1Icon,
        };
      // Zap step types
      case "ZapSwapApproval": {
        const zapStep = step as any;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: zapStep.tokenSymbol || token0Symbol,
          tokenAddress: zapStep.tokenAddress || "",
          tokenIcon: zapStep.tokenSymbol === token0Symbol ? token0Icon : token1Icon,
        };
      }
      case "ZapPSMSwap":
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: (step as any).inputToken || token0Symbol,
          outputTokenSymbol: (step as any).outputToken || token1Symbol,
          routeType: 'psm' as const,
        };
      case "ZapPoolSwap":
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: (step as any).inputToken || token0Symbol,
          outputTokenSymbol: (step as any).outputToken || token1Symbol,
          routeType: 'pool' as const,
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
  const publicClient = usePublicClient();
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
    // Zap mode state
    isZapEligible,
    depositMode,
    zapInputToken,
    setDepositMode,
    setZapInputToken,
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
    // Zap mode data
    isZapMode,
    zapPreview,
    zapApprovals,
    isZapPreviewLoading,
    isZapPreviewFetching,
    zapDataUpdatedAt,
    refetchZapPreview,
  } = useIncreaseLiquidityTxContext();

  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

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

  // Zap refetch countdown timer
  const [zapRefetchCountdown, setZapRefetchCountdown] = useState(10);

  // Live countdown for zap refetch timer - matches ReviewExecuteModal pattern
  useEffect(() => {
    if (!isZapMode || isZapPreviewLoading || isZapPreviewFetching || isExecuting) {
      return;
    }
    // Calculate initial countdown based on when data was last updated
    const updateCountdown = () => {
      const elapsed = Date.now() - (zapDataUpdatedAt || Date.now());
      const remaining = Math.max(0, Math.ceil((10000 - elapsed) / 1000));
      setZapRefetchCountdown(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isZapMode, zapDataUpdatedAt, isZapPreviewLoading, isZapPreviewFetching, isExecuting]);

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

    // =========================================================================
    // ZAP MODE - Single-token deposit with auto-swap
    // =========================================================================
    if (isZapMode && zapPreview && zapApprovals) {
      try {
        console.log('[IncreaseLiquidityForm] Starting Zap execution...');

        // Ensure preview is fresh (< 30 seconds old)
        let preview = zapPreview;
        if (!isPreviewFresh(preview)) {
          console.log('[IncreaseLiquidityForm] Zap preview is stale, refetching...');
          const freshResult = await refetchZapPreview();
          if (!freshResult.data) {
            throw new Error('Failed to refresh zap preview');
          }
          preview = freshResult.data;
        }

        // Get pool config for hook address
        const poolConfig = getPoolById(position.poolId);
        if (!poolConfig?.hooks) {
          throw new Error('Pool hook address not found');
        }

        // Calculate token amounts after swap
        const inputToken = preview.inputTokenInfo.symbol as ZapToken;
        const token0Amount = inputToken === 'USDS'
          ? preview.remainingInputAmount
          : preview.swapOutputAmount;
        const token1Amount = inputToken === 'USDC'
          ? preview.remainingInputAmount
          : preview.swapOutputAmount;

        // Apply shares haircut (0.1%)
        const sharesWithHaircut = (preview.expectedShares * 999n) / 1000n;

        // Get user settings
        const userSettings = getStoredUserSettings();

        // Query initial balances for dust tracking (blockTag: latest to bypass cache)
        let initialBalance0: bigint | undefined;
        let initialBalance1: bigint | undefined;
        const token0Addr = tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address;
        const token1Addr = tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address;
        if (publicClient) {
          try {
            const [balance0, balance1] = await Promise.all([
              publicClient.readContract({
                address: token0Addr,
                abi: ERC20_BALANCE_ABI,
                functionName: 'balanceOf',
                args: [address],
                blockTag: 'latest',
              }) as Promise<bigint>,
              publicClient.readContract({
                address: token1Addr,
                abi: ERC20_BALANCE_ABI,
                functionName: 'balanceOf',
                args: [address],
                blockTag: 'latest',
              }) as Promise<bigint>,
            ]);
            initialBalance0 = balance0;
            initialBalance1 = balance1;
          } catch (e) {
            console.warn('[IncreaseLiquidityForm] Failed to query initial balances:', e);
          }
        }

        const inputAmountUSD = Number(preview.formatted.inputAmount);

        console.log('[IncreaseLiquidityForm] Generating Zap steps:', {
          inputToken,
          swapAmount: preview.swapAmount.toString(),
          remainingInput: preview.remainingInputAmount.toString(),
          token0Amount: token0Amount.toString(),
          token1Amount: token1Amount.toString(),
          sharesWithHaircut: sharesWithHaircut.toString(),
        });

        // Generate zap steps using existing function
        const zapStepsResult = generateZapSteps({
          calculation: preview,
          approvals: zapApprovals,
          hookAddress: poolConfig.hooks as Address,
          userAddress: address,
          sharesToMint: sharesWithHaircut,
          slippageTolerance: userSettings.slippage,
          token0Symbol: position.token0.symbol,
          token1Symbol: position.token1.symbol,
          poolId: position.poolId,
          inputToken,
          token0Address: token0Addr,
          token1Address: token1Addr,
          token0Amount,
          token1Amount,
          approvalMode: userSettings.approvalMode,
          initialBalance0,
          initialBalance1,
          inputAmountUSD,
        });

        console.log('[IncreaseLiquidityForm] Generated', zapStepsResult.totalStepCount, 'zap steps');
        setExecutorSteps(zapStepsResult.steps as TransactionStep[]);

        if (zapStepsResult.steps.length > 0) {
          setCurrentStepIndex(0);
          setStepAccepted(false);
        }

        // Build zap execution context
        // Note: Must use `zapSteps` key - executor checks for this specifically
        const zapContext = {
          type: 'Increase' as const,
          isZapMode: true,
          zapSteps: zapStepsResult.steps,
          hookAddress: poolConfig.hooks,
          chainId,
          token0: {
            address: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address,
            symbol: position.token0.symbol,
            decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18,
            chainId,
          },
          token1: {
            address: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address,
            symbol: position.token1.symbol,
            decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 6,
            chainId,
          },
        };

        await executor.execute(zapContext as any);
      } catch (err: any) {
        console.error('[IncreaseLiquidityForm] Zap error:', err);
        setIsExecuting(false);
        setView("input");
        setLocalError(err?.message || 'Zap transaction failed');
      }
      return;
    }

    // =========================================================================
    // BALANCED MODE - existing dual-token flow (V4 and Unified Yield)
    // =========================================================================

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
  }, [address, chainId, position, hasValidAmounts, fetchAndBuildContext, executor, isUnifiedYield, isZapMode, zapPreview, zapApprovals, refetchZapPreview, tokenDefinitions]);

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
  const isZapDisabled = isZapMode && (!zapPreview || isZapPreviewLoading || isZapPreviewFetching);
  const isDisabled =
    !hasValidAmounts ||
    isOverBalance0 ||
    isOverBalance1 ||
    isCalculating ||
    isLoading ||
    isExecuting ||
    isZapDisabled;

  const buttonText = isOverBalance0 || isOverBalance1
    ? "Insufficient Balance"
    : isZapMode
      ? (isZapPreviewLoading ? "Calculating..." : "Zap & Add Liquidity")
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
            {/* Range/Earning badge - Unified Yield shows "Earning", V4 shows range status */}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  isUnifiedYield ? "bg-green-500" : (position.isInRange ? "bg-green-500" : "bg-red-500")
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isUnifiedYield ? "text-green-500" : (position.isInRange ? "text-green-500" : "text-red-500")
                )}
              >
                {isUnifiedYield ? "Earning" : (position.isInRange ? "In Range" : "Out of Range")}
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
            className="rounded-full "
          />
          <Image
            src={getTokenIcon(position.token1.symbol)}
            alt=""
            width={36}
            height={36}
            className="rounded-full "
          />
        </div>
      </div>

      {/* Deposit Input - Zap mode or Balanced mode */}
      {isZapMode ? (
        <>
          {/* Zap mode: Single token input with switch capability */}
          <TokenInputCard
            id="increase-zap-input"
            tokenSymbol={zapInputToken === 'token0' ? position.token0.symbol : position.token1.symbol}
            value={zapInputToken === 'token0' ? formattedAmounts?.TOKEN0 || '' : formattedAmounts?.TOKEN1 || ''}
            onChange={(value) => zapInputToken === 'token0' ? setAmount0(value) : setAmount1(value)}
            label="Add"
            maxAmount={zapInputToken === 'token0' ? token0Balance : token1Balance}
            usdPrice={zapInputToken === 'token0' ? token0USDPrice : token1USDPrice}
            formatUsdAmount={formatCalculatedAmount}
            isOverBalance={zapInputToken === 'token0' ? isOverBalance0 : isOverBalance1}
            isLoading={false}
            animationControls={zapInputToken === 'token0' ? wiggleControls0 : wiggleControls1}
            onPercentageClick={(percentage) =>
              zapInputToken === 'token0'
                ? handlePercentage0(percentage)
                : handlePercentage1(percentage)
            }
            onTokenClick={() => setZapInputToken(zapInputToken === 'token0' ? 'token1' : 'token0')}
            tokenClickIcon={<RefreshCw className="w-3.5 h-3.5 text-muted-foreground group-hover/token:text-white transition-colors" />}
          />

          {/* Zap Quote Section - only show when there's input */}
          {(zapPreview || isZapPreviewLoading || isZapPreviewFetching) && (
          <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
            {/* Header with countdown badge */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Zap Quote</span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  isZapPreviewLoading || isZapPreviewFetching
                    ? 'bg-muted/50 text-muted-foreground animate-pulse'
                    : 'bg-muted/30 text-muted-foreground/80'
                }`}
              >
                {isZapPreviewLoading || isZapPreviewFetching
                  ? 'Calculating...'
                  : `Refetches in ${zapRefetchCountdown}s`
                }
              </span>
            </div>

            {/* Loading skeleton */}
            {(isZapPreviewLoading || isZapPreviewFetching) && !zapPreview && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Swap amount</span>
                  <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Route</span>
                  <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expected shares</span>
                  <div className="h-4 w-28 bg-muted/50 rounded animate-pulse" />
                </div>
              </>
            )}

            {/* Zap preview data */}
            {zapPreview && (
              <>
                {/* Swap amount row */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Swap amount</span>
                  <span className="text-white">
                    {zapPreview.formatted.swapAmount} {zapPreview.inputTokenInfo.symbol}
                  </span>
                </div>

                {/* Route row with token icons */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Route</span>
                  <div className="flex items-center gap-1">
                    {/* Input token icon */}
                    <Image
                      src={getTokenIcon(zapPreview.inputTokenInfo.symbol)}
                      alt={zapPreview.inputTokenInfo.symbol}
                      width={16}
                      height={16}
                      className="rounded-full"
                    />
                    {/* Chevron */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                      <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                    </svg>
                    {/* Route label */}
                    <span className="text-xs text-muted-foreground">
                      {zapPreview.route.type === 'psm' ? 'PSM' : 'Unified Pool'}
                    </span>
                    {/* Chevron */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                      <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                    </svg>
                    {/* Output token icon */}
                    <Image
                      src={getTokenIcon(zapPreview.inputTokenInfo.symbol === 'USDS' ? 'USDC' : 'USDS')}
                      alt={zapPreview.inputTokenInfo.symbol === 'USDS' ? 'USDC' : 'USDS'}
                      width={16}
                      height={16}
                      className="rounded-full"
                    />
                  </div>
                </div>

                {/* Expected shares row with USD value */}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expected shares</span>
                  <span>
                    <span className="text-muted-foreground">
                      {parseFloat(zapPreview.formatted.expectedShares).toFixed(6)}
                    </span>
                    {zapPreview.shareValue && (
                      <span className="text-white ml-1">
                        (~${(parseFloat(zapPreview.shareValue.formatted0) + parseFloat(zapPreview.shareValue.formatted1)).toFixed(2)})
                      </span>
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
          )}
        </>
      ) : (
        /* Balanced mode: Dual token input */
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
      )}

      {/* Deposit mode toggle - only show before any input, bottom right */}
      {isUnifiedYield && isZapEligible && !hasValidAmounts && (
        <div className="flex justify-end">
          <DepositModeToggle
            depositMode={depositMode}
            onModeChange={setDepositMode}
          />
        </div>
      )}

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
