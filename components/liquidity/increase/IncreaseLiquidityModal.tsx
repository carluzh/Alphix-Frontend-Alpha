"use client";

/**
 * IncreaseLiquidityModal - Uses shared TransactionModal
 *
 * Wraps context providers around TransactionModal. The form content
 * (token inputs, zap preview, position display) is rendered as
 * TransactionModal children. All execution logic is delegated to
 * TransactionModal + useLiquidityExecutors.
 *
 * Supports both balanced (dual-token) and zap (single-token) deposit modes.
 *
 * @see components/transactions/TransactionModal.tsx
 * @see lib/transactions/flows/useIncreaseLiquidityFlow.ts
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { TokenImage } from "@/components/ui/token-image";
import { useAnimation } from "framer-motion";
import { useAccount, usePublicClient } from "wagmi";
import { type Address } from "viem";
import { toast } from "sonner";

import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { chainIdForMode } from "@/lib/network-mode";
import { clearCachedPermit } from "@/lib/permit-types";
import { useChainMismatch } from "@/hooks/useChainMismatch";
import { getPoolBySlug, getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { getStoredUserSettings } from "@/hooks/useUserSettings";
import { formatCalculatedAmount, getTokenIcon } from "../liquidity-form-utils";
import { DepositInputForm, type PositionField } from "../shared/DepositInputForm";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import { TokenInputCard } from "../TokenInputCard";
import { DepositModeToggle } from "../shared/DepositModeToggle";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";

import { TransactionModal } from "@/components/transactions/TransactionModal";
import { IncreaseLiquidityContextProvider, useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { IncreaseLiquidityTxContextProvider, useIncreaseLiquidityTxContext } from "./IncreaseLiquidityTxContext";
import { useIncreaseLiquidityFlow } from "@/lib/transactions/flows/useIncreaseLiquidityFlow";

// Zap utilities
import { generateZapSteps, isPreviewFresh } from "@/lib/liquidity/zap";
import type { ZapToken } from "@/lib/liquidity/zap";
import { getZapPoolConfig } from "@/lib/liquidity/zap/constants";
import { isNativeToken } from "@/lib/aggregators/types";

// Liquidity executors (handles ALL step types including zap)
import { useLiquidityExecutors } from "@/lib/transactions/flows/useLiquidityExecutors";
import { generateLPTransactionSteps } from "@/lib/liquidity/transaction";
import { collapseToBatchedAsync } from "@/lib/liquidity/transaction/steps/collapseBatchedSteps";
import { useCanBatchCalls } from "@/lib/transactions/useCanBatchCalls";
import type { ValidatedLiquidityTxContext, TransactionStep } from "@/lib/liquidity/types";
import { TransactionStepType as UIStepType, type TransactionStep as UITransactionStep } from "@/lib/transactions/types";
import type { StepGenerationResult, StepExecutorFn } from "@/lib/transactions/useStepExecutor";

// ERC20 balanceOf ABI for zap dust tracking
const ERC20_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

// =============================================================================
// TYPES
// =============================================================================

interface IncreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// =============================================================================
// MAP STEPS TO UI
// =============================================================================

function mapStepsToUI(
  steps: unknown[],
  token0Symbol: string,
  token1Symbol: string,
  token0Icon?: string,
  token1Icon?: string,
): UITransactionStep[] {
  return (steps as any[]).map((step): UITransactionStep => {
    switch (step.type) {
      case "TokenApproval":
      case "TokenRevocation":
      case "UnifiedYieldApproval":
      case "ZapSwapApproval": {
        const tokenSymbol = (step as any).token?.symbol || (step as any).tokenSymbol || token0Symbol;
        const tokenAddress = (step as any).token?.address || (step as any).tokenAddress || "";
        const isToken0 = tokenSymbol === token0Symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol,
          tokenAddress,
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }
      case "Permit2Signature":
        return { type: UIStepType.Permit2Signature };
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
      case "IncreasePositionTransaction":
      case "IncreasePositionTransactionAsync":
      case "IncreasePositionTransactionBatchedAsync":
      case "UnifiedYieldDeposit":
      case "ZapDynamicDeposit":
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

// =============================================================================
// INNER COMPONENT (uses contexts)
// =============================================================================

function IncreaseLiquidityInner({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  const { address } = useAccount();
  const { ensureChain } = useChainMismatch();

  const {
    increaseLiquidityState,
    derivedIncreaseLiquidityInfo,
    setAmount0,
    setAmount1,
    hasValidAmounts,
    isOverBalance0,
    isOverBalance1,
    isUnifiedYield,
    isZapEligible,
    depositMode,
    zapInputToken,
    setDepositMode,
    setZapInputToken,
    resetForm,
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
    clearError,
    // Zap mode data
    isZapMode,
    zapPreview,
    zapApprovals,
    isZapPreviewLoading,
    isZapPreviewFetching,
    isZapPreviewError,
    zapPreviewError,
    zapDataUpdatedAt,
    refetchZapPreview,
    setExecuting,
  } = useIncreaseLiquidityTxContext();

  // Reset form when modal opens (false→true transition)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      resetForm();
      setExecuting(false);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, resetForm, setExecuting]);

  const { position } = increaseLiquidityState;
  const networkMode = position.networkMode;
  const chainId = networkMode ? chainIdForMode(networkMode) : undefined;
  const publicClient = usePublicClient({ chainId });
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { formattedAmounts } = derivedIncreaseLiquidityInfo;
  const canBatchCalls = useCanBatchCalls(chainId);

  // Zap refetch countdown timer
  const [zapRefetchCountdown, setZapRefetchCountdown] = useState(10);
  useEffect(() => {
    if (!isZapMode || isZapPreviewLoading || isZapPreviewFetching) return;
    const updateCountdown = () => {
      const elapsed = Date.now() - (zapDataUpdatedAt || Date.now());
      const remaining = Math.max(0, Math.ceil((10000 - elapsed) / 1000));
      setZapRefetchCountdown(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isZapMode, zapDataUpdatedAt, isZapPreviewLoading, isZapPreviewFetching]);

  // Determine deposit disabled states based on position range
  const isOutOfRange = !position.isInRange;
  let deposit0Disabled = false;
  let deposit1Disabled = false;
  if (isOutOfRange) {
    const amt0 = parseFloat(position.token0?.amount || "0");
    const amt1 = parseFloat(position.token1?.amount || "0");
    if (amt0 > 0 && amt1 <= 0) deposit1Disabled = true;
    else if (amt1 > 0 && amt0 <= 0) deposit0Disabled = true;
  }

  // Computed values
  const amount0 = parseFloat(formattedAmounts?.TOKEN0 || "0");
  const amount1 = parseFloat(formattedAmounts?.TOKEN1 || "0");
  const currentToken0Amount = parseFloat(position.token0.amount || "0");
  const currentToken1Amount = parseFloat(position.token1.amount || "0");
  const projectedToken0Amount = currentToken0Amount + amount0;
  const projectedToken1Amount = currentToken1Amount + amount1;
  const showProjected = amount0 > 0 || amount1 > 0;

  // ─── Executors (useLiquidityExecutors handles all step types) ──────────
  const txContextRef = useRef<ValidatedLiquidityTxContext | null>(null);
  const liquidityExecutors = useLiquidityExecutors(txContextRef);

  // ─── Generate steps (handles both balanced and zap paths) ──────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    // ═══ ZAP MODE ═══
    if (isZapMode && !zapPreview) throw new Error('Zap preview not ready — please wait for calculation');
    if (isZapMode && !zapApprovals) throw new Error('Zap approvals not ready — please wait');
    if (isZapMode && zapPreview && zapApprovals) {
      // Ensure preview is fresh
      let preview = zapPreview;
      if (!isPreviewFresh(preview)) {
        const freshResult = await refetchZapPreview();
        if (!freshResult.data) throw new Error('Failed to refresh zap preview');
        preview = freshResult.data;
      }

      const poolConfig = getPoolBySlug(position.poolId, networkMode);
      if (!poolConfig?.hooks) throw new Error('Pool hook address not found');

      const inputToken = preview.inputTokenInfo.symbol as ZapToken;
      const isInputToken0 = inputToken === position.token0.symbol;
      const token0Amount = isInputToken0 ? preview.remainingInputAmount : preview.swapOutputAmount;
      const token1Amount = isInputToken0 ? preview.swapOutputAmount : preview.remainingInputAmount;
      const sharesWithHaircut = (preview.expectedShares * 999n) / 1000n;
      const userSettings = getStoredUserSettings();

      // Query initial balances for dust tracking
      let initialBalance0: bigint | undefined;
      let initialBalance1: bigint | undefined;
      const token0Addr = tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address;
      const token1Addr = tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address;
      const isToken0Native = isNativeToken(token0Addr);
      const isToken1Native = isNativeToken(token1Addr);
      if (publicClient && address) {
        try {
          const [balance0, balance1] = await Promise.all([
            isToken0Native
              ? publicClient.getBalance({ address, blockTag: 'latest' })
              : publicClient.readContract({ address: token0Addr, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address], blockTag: 'latest' }) as Promise<bigint>,
            isToken1Native
              ? publicClient.getBalance({ address, blockTag: 'latest' })
              : publicClient.readContract({ address: token1Addr, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address], blockTag: 'latest' }) as Promise<bigint>,
          ]);
          initialBalance0 = balance0;
          initialBalance1 = balance1;
        } catch (e) {
          console.warn('[IncreaseLiquidityModal] Failed to query initial balances:', e);
        }
      }

      const inputPrice = isInputToken0 ? token0USDPrice : token1USDPrice;
      const inputAmountUSD = Number(preview.formatted.inputAmount) * inputPrice;

      const zapStepsResult = generateZapSteps({
        calculation: preview,
        approvals: zapApprovals,
        hookAddress: poolConfig.hooks as Address,
        userAddress: address!,
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
        poolConfig: getZapPoolConfig(position.poolId) ?? undefined,
        token0Price: token0USDPrice,
        token1Price: token1USDPrice,
        targetChainId: chainId,
      });

      // Store minimal context for zap executors
      txContextRef.current = { chainId } as any;
      return { steps: zapStepsResult.steps };
    }

    // ═══ BALANCED MODE (V4 + Unified Yield) ═══
    const context = await fetchAndBuildContext();
    if (!context) throw new Error("Failed to build transaction context");
    txContextRef.current = context;
    const rawSteps = generateLPTransactionSteps(context);
    if (rawSteps.length === 0) {
      throw new Error("Transaction context produced no executable steps. Refresh and try again.");
    }
    const steps = canBatchCalls ? collapseToBatchedAsync(rawSteps as TransactionStep[]) : rawSteps;
    return { steps };
  }, [
    isZapMode, zapPreview, zapApprovals, refetchZapPreview,
    position, networkMode, chainId, address, publicClient,
    tokenDefinitions, token0USDPrice, token1USDPrice,
    fetchAndBuildContext, canBatchCalls,
  ]);

  // ─── Map steps to UI ──────────────────────────────────────────────────
  const mapStepsToUIFn = useCallback((steps: unknown[]): UITransactionStep[] => {
    return mapStepsToUI(
      steps,
      position.token0.symbol,
      position.token1.symbol,
      getTokenIcon(position.token0.symbol, networkMode),
      getTokenIcon(position.token1.symbol, networkMode),
    );
  }, [position.token0.symbol, position.token1.symbol, networkMode]);

  // ─── Before execute: ensure chain + pause zap refetch ───────────────
  const onBeforeExecute = useCallback(async () => {
    if (chainId) {
      const ok = await ensureChain(chainId);
      if (!ok) return false;
    }
    setExecuting(true);
    return true;
  }, [chainId, ensureChain, setExecuting]);

  // ─── Success handler ──────────────────────────────────────────────────
  const handleSuccess = useCallback((results: Map<number, any>) => {
    setExecuting(false);

    // Clean up cached permits
    if (address && chainId) {
      clearCachedPermit(address, chainId, position.token0.symbol, position.token1.symbol);
    }

    let hash: string | undefined;
    for (const [, result] of results) {
      if (result.txHash) hash = result.txHash;
    }
    if (hash) {
      toast.success("Liquidity added", {
        action: {
          label: "View transaction",
          onClick: () => window.open(getExplorerTxUrl(hash!, networkMode), "_blank"),
        },
      });
    } else {
      toast.success("Liquidity added");
    }
    onSuccess?.();
  }, [onSuccess, address, chainId, networkMode, position.token0.symbol, position.token1.symbol, setExecuting]);

  // ─── Handle user input ────────────────────────────────────────────────
  const handleUserInput = (field: PositionField, value: string) => {
    if (field === "TOKEN0") setAmount0(value);
    else setAmount1(value);
  };

  // ─── Button state ─────────────────────────────────────────────────────
  const isZapDisabled = isZapMode && (!zapPreview || isZapPreviewLoading || isZapPreviewFetching);

  // In zap mode, only check balance for the selected input token
  const hasInsufficientBalance = isZapMode
    ? (zapInputToken === 'token0' ? isOverBalance0 : isOverBalance1)
    : (isOverBalance0 || isOverBalance1);

  const isDisabled =
    !hasValidAmounts ||
    hasInsufficientBalance ||
    isCalculating ||
    isLoading ||
    isZapDisabled;

  const buttonText = hasInsufficientBalance
    ? "Insufficient Balance"
    : isZapMode
      ? (isZapPreviewLoading ? "Calculating..." : "Zap & Add Liquidity")
      : "Add Liquidity";

  return (
    <TransactionModal
      open={isOpen}
      onClose={onClose}
      title="Add Liquidity"
      confirmText={buttonText}
      confirmDisabled={isDisabled}
      generateSteps={generateSteps}
      executors={liquidityExecutors}
      mapStepsToUI={mapStepsToUIFn}
      onBeforeExecute={onBeforeExecute}
      onSuccess={handleSuccess}
      onExecutionEnd={useCallback(() => setExecuting(false), [setExecuting])}
    >
      <div className="space-y-4">
        {/* Header - Token pair with badges */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-white">{position.token0.symbol}</span>
              <span className="text-2xl font-semibold text-muted-foreground">/</span>
              <span className="text-2xl font-semibold text-white">{position.token1.symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", isUnifiedYield ? "bg-green-500" : (position.isInRange ? "bg-green-500" : "bg-red-500"))} />
                <span className={cn("text-xs font-medium", isUnifiedYield ? "text-green-500" : (position.isInRange ? "text-green-500" : "text-red-500"))}>
                  {isUnifiedYield ? "Earning" : (position.isInRange ? "In Range" : "Out of Range")}
                </span>
              </div>
              {position.poolId && (() => {
                const poolConfig = getPoolBySlug(position.poolId, networkMode);
                const isUY = poolConfig?.rehypoRange !== undefined;
                return isUY ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}>
                    Unified Yield
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground">Custom</span>
                );
              })()}
            </div>
          </div>
          <div className="flex items-center -space-x-2">
            <TokenImage src={getTokenIcon(position.token0.symbol, networkMode)} alt="" size={36} />
            <TokenImage src={getTokenIcon(position.token1.symbol, networkMode)} alt="" size={36} />
          </div>
        </div>

        {/* Deposit Input - Zap mode or Balanced mode */}
        {isZapMode ? (
          <>
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

            {/* Zap error callout */}
            {isZapPreviewError && !isZapPreviewFetching && (
              <div
                className="flex flex-row items-center gap-3 rounded-lg border p-3 transition-colors"
                style={{ backgroundColor: 'rgba(255, 89, 60, 0.08)', borderColor: 'rgba(255, 89, 60, 0.2)' }}
              >
                <div className="flex items-center justify-center p-2 rounded-md shrink-0" style={{ backgroundColor: 'rgba(255, 89, 60, 0.12)' }}>
                  <AlertCircle className="w-4 h-4" style={{ color: '#FF593C' }} />
                </div>
                <span className="text-sm font-medium" style={{ color: '#FF593C' }}>
                  {zapPreviewError?.message || 'Failed to calculate zap preview'}
                </span>
              </div>
            )}

            {/* Zap Quote Section */}
            {(zapPreview || isZapPreviewLoading || isZapPreviewFetching) && (
              <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Zap Quote</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    isZapPreviewLoading || isZapPreviewFetching
                      ? 'bg-muted/50 text-muted-foreground animate-pulse'
                      : 'bg-muted/30 text-muted-foreground/80'
                  }`}>
                    {isZapPreviewLoading || isZapPreviewFetching ? 'Calculating...' : `Refetches in ${zapRefetchCountdown}s`}
                  </span>
                </div>

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

                {zapPreview && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Swap amount</span>
                      <span className="text-white">{zapPreview.formatted.swapAmount} {zapPreview.inputTokenInfo.symbol}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Route</span>
                      <div className="flex items-center gap-1">
                        <TokenImage src={getTokenIcon(zapPreview.inputTokenInfo.symbol, networkMode)} alt={zapPreview.inputTokenInfo.symbol} size={16} />
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                          <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                        </svg>
                        <span className="text-xs text-muted-foreground">
                          {zapPreview.route.type === 'psm' ? 'PSM' : zapPreview.route.type === 'kyberswap' ? 'Kyberswap' : 'Custom Pool'}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                          <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                        </svg>
                        <TokenImage src={getTokenIcon(zapPreview.outputTokenInfo.symbol, networkMode)} alt={zapPreview.outputTokenInfo.symbol} size={16} />
                      </div>
                    </div>
                    {zapPreview.route.priceImpact >= 3 && (
                      <div className={`flex items-center gap-1.5 text-xs ${zapPreview.route.priceImpact >= 5 ? 'text-red-400' : 'text-yellow-400'}`}>
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {zapPreview.route.priceImpact >= 5 ? 'Very high' : 'High'} price impact ({zapPreview.route.priceImpact.toFixed(2)}%)
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Expected shares</span>
                      <span>
                        <span className="text-muted-foreground">{parseFloat(zapPreview.formatted.expectedShares).toFixed(6)}</span>
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
          <DepositInputForm
            token0Symbol={position.token0.symbol}
            token1Symbol={position.token1.symbol}
            formattedAmounts={formattedAmounts}
            currencyBalances={{ TOKEN0: token0Balance, TOKEN1: token1Balance }}
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

        {/* Deposit mode toggle */}
        {isUnifiedYield && isZapEligible && !hasValidAmounts && (
          <div className="flex justify-end">
            <DepositModeToggle depositMode={depositMode} onModeChange={setDepositMode} />
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
          title={showProjected ? "Projected Position" : "Current Position"}
        />
      </div>
    </TransactionModal>
  );
}

// =============================================================================
// MAIN EXPORT (wraps providers)
// =============================================================================

export function IncreaseLiquidityModal({
  position,
  isOpen,
  onClose,
  onSuccess,
}: IncreaseLiquidityModalProps) {
  return (
    <IncreaseLiquidityContextProvider position={position}>
      <IncreaseLiquidityTxContextProvider>
        <IncreaseLiquidityInner isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />
      </IncreaseLiquidityTxContextProvider>
    </IncreaseLiquidityContextProvider>
  );
}

export default IncreaseLiquidityModal;
