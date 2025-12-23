"use client";

/**
 * AddLiquidityForm (V2)
 *
 * Simplified form component that consumes from AddLiquidityContext.
 * Follows Uniswap's pattern of separating state management from UI.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Plus, Maximize, CircleHelp, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { toast } from "sonner";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { getStoredDeadlineSeconds } from "@/hooks/useUserSettings";
import { useAccount } from "wagmi";
import { getPoolById } from "@/lib/pools-config";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import { calculateTicksFromPercentage } from "@/lib/liquidity/utils/calculations";
import { useAddLiquidityContext } from "./context";
import { useAddLiquidityTransaction } from "./useAddLiquidityTransactionV2";
import { RangeSelectionModalV2 } from "./range-selection/RangeSelectionModalV2";
import { TokenAmountInput } from "./TokenAmountInput";
import { TransactionFlowPanel } from "./TransactionFlowPanel";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { Token } from '@uniswap/sdk-core';
import { getAddress } from "viem";
import { getTokenDefinitions } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { convertTickToPrice as convertTickToPriceUtil } from "@/lib/denomination-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showErrorToast, showInfoToast } from "@/lib/ui/toasts";

export interface AddLiquidityFormProps {
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string) => void;
  selectedPoolId?: string;
  activeTab: 'deposit' | 'withdraw' | 'swap';
  onRangeChange?: (rangeInfo: {
    preset: string | null;
    label: string;
    estimatedApy: string;
    hasUserInteracted: boolean;
    isCalculating: boolean;
  }) => void;
}

export function AddLiquidityForm({
  onLiquidityAdded,
  selectedPoolId,
  activeTab,
  onRangeChange,
}: AddLiquidityFormProps) {
  // Get everything from context
  const ctx = useAddLiquidityContext();
  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { networkMode } = useNetwork();
  const tokenDefinitions = getTokenDefinitions(networkMode);
  const signer = useEthersSigner();
  const userDeadlineSeconds = getStoredDeadlineSeconds();

  // Track previous calculation dependencies
  const prevCalculationDeps = useRef({
    amount0: ctx.depositState.amount0,
    amount1: ctx.depositState.amount1,
    tickLower: ctx.rangeState.tickLower,
    tickUpper: ctx.rangeState.tickUpper,
    activeInputSide: ctx.depositState.activeInputSide,
    zapSlippageToleranceBps: ctx.zapSlippageToleranceBps,
  });

  // Transaction hook
  const transaction = useAddLiquidityTransaction({
    token0Symbol: ctx.token0Symbol,
    token1Symbol: ctx.token1Symbol,
    amount0: ctx.depositState.amount0,
    amount1: ctx.depositState.amount1,
    tickLower: ctx.rangeState.tickLower,
    tickUpper: ctx.rangeState.tickUpper,
    activeInputSide: ctx.depositState.activeInputSide,
    calculatedData: ctx.calculatedData,
    onLiquidityAdded,
    onOpenChange: ctx.setShowingTransactionSteps,
    isZapMode: ctx.zapState.isZapMode,
    zapInputToken: ctx.zapState.zapInputToken,
    zapSlippageToleranceBps: ctx.zapState.isZapMode ? ctx.zapSlippageToleranceBps : undefined,
    deadlineSeconds: userDeadlineSeconds,
  });

  // Percentage input handlers
  const setAmount0WithPrecision = useCallback((value: string) => {
    ctx.setAmount0(value);
    ctx.setAmount0FullPrecision(value);
  }, [ctx]);

  const setAmount1WithPrecision = useCallback((value: string) => {
    ctx.setAmount1(value);
    ctx.setAmount1FullPrecision(value);
  }, [ctx]);

  const handleToken0Percentage = usePercentageInput(
    ctx.token0BalanceData,
    { decimals: tokenDefinitions[ctx.token0Symbol]?.decimals || 18, symbol: ctx.token0Symbol },
    setAmount0WithPrecision
  );

  const handleToken1Percentage = usePercentageInput(
    ctx.token1BalanceData,
    { decimals: tokenDefinitions[ctx.token1Symbol]?.decimals || 18, symbol: ctx.token1Symbol },
    setAmount1WithPrecision
  );

  // Derived pool tokens for RangeSelectionModal
  const { poolToken0, poolToken1 } = React.useMemo(() => {
    if (!ctx.token0Symbol || !ctx.token1Symbol || !chainId) return { poolToken0: null, poolToken1: null };
    const currentToken0Def = tokenDefinitions[ctx.token0Symbol];
    const currentToken1Def = tokenDefinitions[ctx.token1Symbol];
    if (!currentToken0Def || !currentToken1Def) return { poolToken0: null, poolToken1: null };

    const sdkBaseToken0 = new Token(chainId, getAddress(currentToken0Def.address), currentToken0Def.decimals, currentToken0Def.symbol);
    const sdkBaseToken1 = new Token(chainId, getAddress(currentToken1Def.address), currentToken1Def.decimals, currentToken1Def.symbol);

    const [pt0, pt1] = sdkBaseToken0.sortsBefore(sdkBaseToken1)
      ? [sdkBaseToken0, sdkBaseToken1]
      : [sdkBaseToken1, sdkBaseToken0];
    return { poolToken0: pt0, poolToken1: pt1 };
  }, [ctx.token0Symbol, ctx.token1Symbol, chainId, tokenDefinitions]);

  const isInverted = ctx.baseTokenForPriceDisplay === ctx.token0Symbol;

  // Handle selecting a preset
  const handleSelectPreset = useCallback((preset: string) => {
    transaction.reset();
    ctx.setActivePreset(preset);
    ctx.setHasUserInteracted(true);

    if (preset === "Full Range") {
      ctx.setTickLower(ctx.sdkMinTick.toString());
      ctx.setTickUpper(ctx.sdkMaxTick.toString());
      ctx.setInitialDefaultApplied(true);
      if (ctx.poolState.currentPoolTick !== null) {
        const widePct = ctx.isStablePool ? 0.03 : 0.15;
        const tickDelta = Math.round(Math.log(1 + widePct) / Math.log(1.0001));
        const viewportLower = Math.floor((ctx.poolState.currentPoolTick - tickDelta) / ctx.defaultTickSpacing) * ctx.defaultTickSpacing;
        const viewportUpper = Math.ceil((ctx.poolState.currentPoolTick + tickDelta) / ctx.defaultTickSpacing) * ctx.defaultTickSpacing;
        ctx.resetChartViewbox(viewportLower, viewportUpper, 1/3, 1/3);
      }
    } else {
      ctx.setInitialDefaultApplied(true);
    }
  }, [ctx, transaction]);

  // Handle use full balance
  const handleUseFullBalance = useCallback((isToken0: boolean) => {
    try {
      if (isToken0) {
        handleToken0Percentage(100);
        ctx.setActiveInputSide('amount0');
      } else {
        handleToken1Percentage(100);
        ctx.setActiveInputSide('amount1');
      }
      transaction.reset();
      ctx.setShowingTransactionSteps(false);
    } catch {
      // Ignore balance errors
    }
  }, [ctx, transaction, handleToken0Percentage, handleToken1Percentage]);

  // Sign permit
  const signPermit = useCallback(async (): Promise<string | undefined> => {
    if (ctx.zapState.isZapMode || !transaction.approvalData || !('permitBatchData' in transaction.approvalData) || !transaction.approvalData.permitBatchData || !transaction.approvalData.signatureDetails) {
      return undefined;
    }

    if (!signer) {
      showErrorToast("Wallet not connected");
      return undefined;
    }

    try {
      const valuesToSign = transaction.approvalData.permitBatchData.values || transaction.approvalData.permitBatchData;
      const signature = await (signer as any)._signTypedData(
        transaction.approvalData.signatureDetails.domain,
        transaction.approvalData.signatureDetails.types,
        valuesToSign
      );

      const currentTime = Math.floor(Date.now() / 1000);
      const sigDeadline = valuesToSign?.sigDeadline || valuesToSign?.details?.[0]?.expiration || 0;
      const durationSeconds = Number(sigDeadline) - currentTime;
      let durationFormatted = "";
      if (durationSeconds >= 86400) {
        const days = Math.ceil(durationSeconds / 86400);
        durationFormatted = `${days} day${days > 1 ? 's' : ''}`;
      } else if (durationSeconds >= 3600) {
        const hours = Math.ceil(durationSeconds / 3600);
        durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        const minutes = Math.ceil(durationSeconds / 60);
        durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      }

      toast.success('Batch Signature Complete', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Batch permit signed successfully for ${durationFormatted}`
      });
      return signature;
    } catch (error: any) {
      const isUserRejection =
        error.message?.toLowerCase().includes('user rejected') ||
        error.message?.toLowerCase().includes('user denied') ||
        error.code === 4001;

      if (!isUserRejection) {
        showErrorToast("Signature Error", { description: error.message });
      }
      throw error;
    }
  }, [transaction.approvalData, signer, ctx.zapState.isZapMode]);

  // Wrapper for convertTickToPrice
  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    return convertTickToPriceUtil(tick, currentPoolTick, currentPrice, baseTokenForPriceDisplay, token0Symbol, token1Symbol, ctx.sdkMinTick, ctx.sdkMaxTick);
  }, [ctx.sdkMinTick, ctx.sdkMaxTick]);

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  // Effect to auto-apply preset when pool tick changes
  useEffect(() => {
    if (!ctx.rangeState.activePreset || ctx.poolState.currentPoolTick === null) return;

    const PRESET_PERCENTAGES: Record<string, number> = {
      "±0.1%": 0.1, "±0.5%": 0.5, "±1%": 1, "±3%": 3, "±8%": 8, "±15%": 15
    };

    if (ctx.rangeState.activePreset === "Full Range") {
      if (ctx.rangeState.tickLower !== ctx.sdkMinTick.toString() || ctx.rangeState.tickUpper !== ctx.sdkMaxTick.toString()) {
        transaction.reset();
        ctx.setTickLower(ctx.sdkMinTick.toString());
        ctx.setTickUpper(ctx.sdkMaxTick.toString());
        ctx.setInitialDefaultApplied(true);
        const [viewportLower, viewportUpper] = calculateTicksFromPercentage(
          ctx.isStablePool ? 3 : 15, ctx.isStablePool ? 3 : 15, ctx.poolState.currentPoolTick, ctx.defaultTickSpacing
        );
        ctx.resetChartViewbox(viewportLower, viewportUpper, 1/3, 1/3);
      }
      return;
    }

    const percentValue = PRESET_PERCENTAGES[ctx.rangeState.activePreset];
    if (!percentValue) return;

    let [newTickLower, newTickUpper] = calculateTicksFromPercentage(
      percentValue, percentValue, ctx.poolState.currentPoolTick, ctx.defaultTickSpacing
    );

    newTickLower = Math.max(ctx.sdkMinTick, Math.min(ctx.sdkMaxTick, newTickLower));
    newTickUpper = Math.max(ctx.sdkMinTick, Math.min(ctx.sdkMaxTick, newTickUpper));

    if (newTickUpper - newTickLower >= ctx.defaultTickSpacing) {
      if (newTickLower.toString() !== ctx.rangeState.tickLower || newTickUpper.toString() !== ctx.rangeState.tickUpper) {
        transaction.reset();
        ctx.setTickLower(newTickLower.toString());
        ctx.setTickUpper(newTickUpper.toString());
        ctx.setInitialDefaultApplied(true);
        ctx.resetChartViewbox(newTickLower, newTickUpper, 1/3, 1/3);
      }
    } else {
      showInfoToast("Preset Range Too Narrow");
    }
  }, [ctx.poolState.currentPoolTick, ctx.rangeState.activePreset, ctx.defaultTickSpacing, ctx.sdkMinTick, ctx.sdkMaxTick, ctx.rangeState.tickLower, ctx.rangeState.tickUpper, transaction, ctx.isStablePool, ctx.resetChartViewbox, ctx.setTickLower, ctx.setTickUpper, ctx.setInitialDefaultApplied]);

  // Trigger calculation when inputs change
  useEffect(() => {
    const prev = prevCalculationDeps.current;
    const ticksChanged = ctx.rangeState.tickLower !== prev.tickLower || ctx.rangeState.tickUpper !== prev.tickUpper;
    const slippageChanged = ctx.zapState.isZapMode && ctx.zapSlippageToleranceBps !== prev.zapSlippageToleranceBps;
    const inputSideChanged = ctx.depositState.activeInputSide !== prev.activeInputSide;

    let shouldCalculate = false;
    if (ctx.depositState.activeInputSide === 'amount0') {
      shouldCalculate = ctx.depositState.amount0 !== prev.amount0 || ticksChanged || inputSideChanged || slippageChanged;
    } else if (ctx.depositState.activeInputSide === 'amount1') {
      shouldCalculate = ctx.depositState.amount1 !== prev.amount1 || ticksChanged || inputSideChanged || slippageChanged;
    } else {
      const amountsChanged = ctx.depositState.amount0 !== prev.amount0 || ctx.depositState.amount1 !== prev.amount1;
      const hasAmount = parseFloat(ctx.depositState.amount0) > 0 || parseFloat(ctx.depositState.amount1) > 0;
      shouldCalculate = (amountsChanged || ticksChanged || slippageChanged) && hasAmount;
    }

    if (shouldCalculate) {
      const inputSideForCalc = ctx.depositState.activeInputSide || (parseFloat(ctx.depositState.amount0) > 0 ? 'amount0' : parseFloat(ctx.depositState.amount1) > 0 ? 'amount1' : null);
      if (inputSideForCalc) {
        const primaryAmount = inputSideForCalc === 'amount0' ? ctx.depositState.amount0 : ctx.depositState.amount1;
        const tlNum = parseInt(ctx.rangeState.tickLower);
        const tuNum = parseInt(ctx.rangeState.tickUpper);
        const ticksAreValid = !isNaN(tlNum) && !isNaN(tuNum) && tlNum < tuNum;

        if (parseFloat(primaryAmount || "0") > 0 && ticksAreValid) {
          ctx.triggerCalculation({
            amount0: ctx.depositState.amount0,
            amount1: ctx.depositState.amount1,
            tickLower: ctx.rangeState.tickLower,
            tickUpper: ctx.rangeState.tickUpper,
            inputSide: inputSideForCalc,
            currentPoolTick: ctx.poolState.currentPoolTick,
            currentPrice: ctx.poolState.currentPrice,
            isShowingTransactionSteps: ctx.uiState.showingTransactionSteps,
          });
          if (!ctx.uiState.showingTransactionSteps) {
            ctx.resetZapState();
          }
        } else if ((parseFloat(primaryAmount || "0") <= 0 && ctx.depositState.activeInputSide === inputSideForCalc) || !ticksAreValid) {
          if (inputSideForCalc === 'amount0' && ctx.depositState.amount1 !== "") ctx.setAmount1("");
          else if (inputSideForCalc === 'amount1' && ctx.depositState.amount0 !== "") ctx.setAmount0("");
          ctx.resetCalculation();
          if (!ticksAreValid && (parseFloat(ctx.depositState.amount0) > 0 || parseFloat(ctx.depositState.amount1) > 0)) {
            showInfoToast("Invalid Range");
          }
        }
      } else {
        if (ctx.depositState.amount0 !== "" || ctx.depositState.amount1 !== "") {
          ctx.setAmount0("");
          ctx.setAmount1("");
        }
        if (ctx.depositState.amount0FullPrecision !== "" || ctx.depositState.amount1FullPrecision !== "") {
          ctx.setAmount0FullPrecision("");
          ctx.setAmount1FullPrecision("");
        }
        ctx.resetCalculation();
        transaction.reset();
        ctx.setShowingTransactionSteps(false);
      }
    } else if (parseFloat(ctx.depositState.amount0) <= 0 && parseFloat(ctx.depositState.amount1) <= 0) {
      ctx.resetCalculation();
      transaction.reset();
      ctx.setShowingTransactionSteps(false);
    }

    prevCalculationDeps.current = {
      amount0: ctx.depositState.amount0,
      amount1: ctx.depositState.amount1,
      tickLower: ctx.rangeState.tickLower,
      tickUpper: ctx.rangeState.tickUpper,
      activeInputSide: ctx.depositState.activeInputSide,
      zapSlippageToleranceBps: ctx.zapSlippageToleranceBps,
    };
  }, [ctx, transaction]);

  // Reset on deposit success
  useEffect(() => {
    if (transaction.isDepositSuccess) {
      ctx.setAmount0("");
      ctx.setAmount1("");
      ctx.setAmount0FullPrecision("");
      ctx.setAmount1FullPrecision("");
      ctx.resetCalculation();
      ctx.setShowingTransactionSteps(false);
      transaction.reset();
      transaction.refetchApprovals();
    }
  }, [transaction.isDepositSuccess, transaction, ctx]);

  // Check for insufficient balance
  useEffect(() => {
    const t0Def = tokenDefinitions[ctx.token0Symbol];
    const t1Def = tokenDefinitions[ctx.token1Symbol];
    let insufficient = false;

    if (!t0Def || !t1Def) return;

    if (ctx.zapState.isZapMode) {
      const inputTokenDef = ctx.zapState.zapInputToken === 'token0' ? t0Def : t1Def;
      const inputBalanceData = ctx.zapState.zapInputToken === 'token0' ? ctx.token0BalanceData : ctx.token1BalanceData;
      const inputAmount = ctx.zapState.zapInputToken === 'token0' ? ctx.depositState.amount0 : ctx.depositState.amount1;

      if (parseFloat(inputAmount || "0") > 0 && inputBalanceData?.value) {
        try {
          const valueToCheck = safeParseUnits(inputAmount, inputTokenDef.decimals);
          if (valueToCheck > inputBalanceData.value) insufficient = true;
        } catch {}
      }
    } else {
      const isAmount0Positive = parseFloat(ctx.depositState.amount0 || "0") > 0;
      const isAmount1Positive = parseFloat(ctx.depositState.amount1 || "0") > 0;

      if (isAmount0Positive && ctx.token0BalanceData?.value) {
        try {
          const val = safeParseUnits(ctx.depositState.amount0, t0Def.decimals);
          if (val > ctx.token0BalanceData.value) insufficient = true;
        } catch {}
      }

      if (!insufficient && isAmount1Positive && ctx.token1BalanceData?.value) {
        try {
          const val = safeParseUnits(ctx.depositState.amount1, t1Def.decimals);
          if (val > ctx.token1BalanceData.value) insufficient = true;
        } catch {}
      }

      if (!insufficient && ctx.calculatedData) {
        if (!isAmount0Positive && BigInt(ctx.calculatedData.amount0) > 0n && ctx.token0BalanceData?.value) {
          if (BigInt(ctx.calculatedData.amount0) > ctx.token0BalanceData.value) insufficient = true;
        }
        if (!insufficient && !isAmount1Positive && BigInt(ctx.calculatedData.amount1) > 0n && ctx.token1BalanceData?.value) {
          if (BigInt(ctx.calculatedData.amount1) > ctx.token1BalanceData.value) insufficient = true;
        }
      }
    }

    // Note: We'd need to add setIsInsufficientBalance to context or track locally
    // For now, we'll compute this inline
  }, [ctx, tokenDefinitions]);

  // Notify parent of range/APY changes
  useEffect(() => {
    if (onRangeChange) {
      const label = ctx.getPresetDisplayLabel(ctx.rangeState.activePreset, ctx.isStablePool);
      onRangeChange({
        preset: ctx.rangeState.activePreset,
        label,
        estimatedApy: ctx.estimatedApy,
        hasUserInteracted: ctx.uiState.hasUserInteracted,
        isCalculating: ctx.isCalculatingApy,
      });
    }
  }, [ctx.rangeState.activePreset, ctx.estimatedApy, ctx.isStablePool, onRangeChange, ctx.getPresetDisplayLabel, ctx.uiState.hasUserInteracted, ctx.isCalculatingApy]);

  // Compute insufficient balance inline
  const isInsufficientBalance = React.useMemo(() => {
    const t0Def = tokenDefinitions[ctx.token0Symbol];
    const t1Def = tokenDefinitions[ctx.token1Symbol];
    if (!t0Def || !t1Def) return false;

    if (ctx.zapState.isZapMode) {
      const inputTokenDef = ctx.zapState.zapInputToken === 'token0' ? t0Def : t1Def;
      const inputBalanceData = ctx.zapState.zapInputToken === 'token0' ? ctx.token0BalanceData : ctx.token1BalanceData;
      const inputAmount = ctx.zapState.zapInputToken === 'token0' ? ctx.depositState.amount0 : ctx.depositState.amount1;

      if (parseFloat(inputAmount || "0") > 0 && inputBalanceData?.value) {
        try {
          const valueToCheck = safeParseUnits(inputAmount, inputTokenDef.decimals);
          if (valueToCheck > inputBalanceData.value) return true;
        } catch {}
      }
      return false;
    }

    const isAmount0Positive = parseFloat(ctx.depositState.amount0 || "0") > 0;
    const isAmount1Positive = parseFloat(ctx.depositState.amount1 || "0") > 0;

    if (isAmount0Positive && ctx.token0BalanceData?.value) {
      try {
        const val = safeParseUnits(ctx.depositState.amount0, t0Def.decimals);
        if (val > ctx.token0BalanceData.value) return true;
      } catch {}
    }

    if (isAmount1Positive && ctx.token1BalanceData?.value) {
      try {
        const val = safeParseUnits(ctx.depositState.amount1, t1Def.decimals);
        if (val > ctx.token1BalanceData.value) return true;
      } catch {}
    }

    return false;
  }, [ctx, tokenDefinitions]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="space-y-4">
      {activeTab === 'deposit' && (
        <>
          {/* Range Section */}
          {!ctx.uiState.showingTransactionSteps && (
            <div className="border border-dashed rounded-md bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Range</Label>
                <div className="flex items-center gap-2">
                  {ctx.rangeState.activePreset === null ? (
                    <span className="text-xs text-muted-foreground">Please Select Range</span>
                  ) : !ctx.poolState.currentPrice || !ctx.minPriceInputString || !ctx.maxPriceInputString ? (
                    <>
                      <div className="h-4 w-12 bg-muted/50 rounded animate-pulse" />
                      <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
                    </>
                  ) : (
                    <>
                      {ctx.rangeLabels && (
                        <div className="flex items-center gap-1 text-xs min-w-0">
                          <div
                            className={cn(
                              "text-muted-foreground hover:text-white px-1 py-1 transition-colors cursor-pointer",
                              "truncate max-w-[110px] sm:max-w-[160px]"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              ctx.setModalInitialFocusField('min');
                              ctx.setShowRangeModal(true);
                            }}
                          >
                            {ctx.rangeLabels.left}
                          </div>
                          <span className="text-muted-foreground">-</span>
                          <div
                            className={cn(
                              "text-muted-foreground hover:text-white px-1 py-1 transition-colors cursor-pointer",
                              "truncate max-w-[110px] sm:max-w-[160px]"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              ctx.setModalInitialFocusField('max');
                              ctx.setShowRangeModal(true);
                            }}
                          >
                            {ctx.rangeLabels.right}
                          </div>
                          {ctx.poolState.currentPrice && (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded border border-sidebar-border text-muted-foreground">
                                    <span className="inline-block w-[2px] h-2" style={{ background: '#e85102' }} />
                                    <span className="select-none">{ctx.formattedCurrentPrice}</span>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                  Current Pool Price
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Range Buttons */}
              <div className="grid grid-cols-4 gap-2">
                {["Full Range", "Wide", "Narrow", "Custom"].map((preset) => {
                  const presetValue = (() => {
                    if (preset === "Full Range") return "Full Range";
                    if (preset === "Wide") return ctx.isStablePool ? "±3%" : "±15%";
                    if (preset === "Narrow") return ctx.isStablePool ? "±0.5%" : "±3%";
                    return null;
                  })();

                  const isActive = ctx.rangeState.activePreset !== null && ctx.rangeState.activePreset === presetValue;
                  const isCustom = preset === "Custom";

                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        if (preset === "Custom") {
                          ctx.setShowRangeModal(true);
                        } else {
                          handleSelectPreset(presetValue!);
                        }
                      }}
                      className={`relative h-10 px-2 flex items-center justify-center gap-1.5 rounded-md border transition-all duration-200 overflow-hidden text-[11px] font-medium cursor-pointer ${
                        isActive
                          ? 'text-sidebar-primary border-sidebar-primary bg-button-primary'
                          : 'border-sidebar-border bg-button hover:bg-accent hover:brightness-110 hover:border-white/30 text-white'
                      }`}
                      style={!isActive ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      {isCustom && <Maximize className={`w-3 h-3 relative z-10 max-[399px]:hidden ${isActive ? 'text-sidebar-primary' : 'text-muted-foreground'}`} />}
                      <span className="relative z-10">{preset}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Range Selection Modal */}
          {!ctx.uiState.showingTransactionSteps && (
            <RangeSelectionModalV2
              isOpen={ctx.uiState.showRangeModal}
              onClose={() => {
                ctx.setShowRangeModal(false);
                ctx.setModalInitialFocusField(null);
              }}
              onConfirm={(newTickLower, newTickUpper, selectedPreset, denomination) => {
                ctx.setTickLower(newTickLower);
                ctx.setTickUpper(newTickUpper);
                transaction.reset();
                ctx.setInitialDefaultApplied(true);
                ctx.setActivePreset(selectedPreset || null);
                ctx.setHasUserInteracted(true);
                if (denomination) {
                  ctx.setBaseTokenForPriceDisplay(denomination);
                }
                ctx.resetAmounts();
                ctx.setActiveInputSide(null);
                ctx.resetCalculation();
                ctx.setModalInitialFocusField(null);
              }}
              initialTickLower={ctx.rangeState.tickLower}
              initialTickUpper={ctx.rangeState.tickUpper}
              initialActivePreset={ctx.rangeState.activePreset}
              selectedPoolId={selectedPoolId}
              chainId={chainId}
              token0Symbol={ctx.token0Symbol}
              token1Symbol={ctx.token1Symbol}
              currentPrice={ctx.poolState.currentPrice}
              currentPoolTick={ctx.poolState.currentPoolTick}
              currentPoolSqrtPriceX96={ctx.poolState.currentPoolSqrtPriceX96}
              minPriceDisplay={ctx.minPriceInputString}
              maxPriceDisplay={ctx.maxPriceInputString}
              baseTokenSymbol={ctx.baseTokenForPriceDisplay}
              sdkMinTick={ctx.sdkMinTick}
              sdkMaxTick={ctx.sdkMaxTick}
              defaultTickSpacing={ctx.defaultTickSpacing}
              xDomain={ctx.uiState.xDomain}
              onXDomainChange={ctx.setXDomain}
              poolToken0={poolToken0}
              poolToken1={poolToken1}
              presetOptions={ctx.presetOptions}
              isInverted={isInverted}
              initialFocusField={ctx.uiState.modalInitialFocusField}
              poolMetricsData={ctx.cachedPoolMetrics}
              poolType={selectedPoolId ? getPoolById(selectedPoolId)?.type : undefined}
            />
          )}

          {/* Single Token Mode Toggle */}
          <div
            onClick={() => {
              if (transaction.isWorking || ctx.uiState.showingTransactionSteps) return;
              ctx.setIsZapMode(!ctx.zapState.isZapMode);
              ctx.resetAmounts();
              ctx.resetZapState();
              ctx.setActiveInputSide(null);
              ctx.resetCalculation();
              transaction.reset();
            }}
            className={cn(
              "cursor-pointer hover:bg-muted/20 transition-colors p-4 rounded-lg bg-surface border border-sidebar-border/60",
              transaction.isWorking || ctx.uiState.showingTransactionSteps ? "opacity-50 pointer-events-none" : ""
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="zap-mode" className="text-sm font-medium cursor-pointer">Single Token Mode</Label>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-3 w-3 text-muted-foreground" onClick={(e) => e.stopPropagation()} />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px] text-xs">
                      <p className="mb-2">Provide liquidity using a single token. We'll automatically swap the optimal amount to maximize your liquidity.</p>
                      <p className="text-[10px] text-muted-foreground/90">Note: Large deposits relative to pool liquidity may experience higher price impact during the swap.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Checkbox
                id="zap-mode"
                checked={ctx.zapState.isZapMode}
                onCheckedChange={(checked) => {
                  if (transaction.isWorking || ctx.uiState.showingTransactionSteps) return;
                  ctx.setIsZapMode(checked === true);
                  ctx.resetAmounts();
                  ctx.resetZapState();
                  ctx.setActiveInputSide(null);
                  ctx.resetCalculation();
                  transaction.reset();
                }}
                disabled={transaction.isWorking || ctx.uiState.showingTransactionSteps}
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-5"
              />
            </div>
          </div>

          {/* Token 0 Input */}
          {(!ctx.zapState.isZapMode || ctx.zapState.zapInputToken === 'token0') && (
            <TokenAmountInput
              tokenSymbol={ctx.token0Symbol}
              amount={ctx.depositState.amount0}
              fullPrecisionAmount={ctx.depositState.amount0FullPrecision}
              balanceData={ctx.token0BalanceData}
              isLoadingBalance={ctx.isLoadingToken0Balance}
              isFocused={ctx.uiState.isAmount0Focused}
              canAdd={ctx.canAddToken0}
              isWorking={transaction.isWorking}
              isCalculating={ctx.isCalculating}
              isConnected={isConnected}
              isZapMode={ctx.zapState.isZapMode}
              showingTransactionSteps={ctx.uiState.showingTransactionSteps}
              isOtherInputActive={ctx.depositState.activeInputSide === 'amount1'}
              calculatedAmountWei={ctx.calculatedData?.amount0}
              tokenDecimals={tokenDefinitions[ctx.token0Symbol]?.decimals || 18}
              wiggleControls={ctx.balanceWiggleControls0}
              onAmountChange={(value) => {
                ctx.setAmount0FullPrecision("");
                transaction.reset();
                ctx.setShowingTransactionSteps(false);
                ctx.setAmount0(value);
                ctx.setActiveInputSide('amount0');
                ctx.setHasUserInteracted(true);
              }}
              onFocus={() => ctx.setIsAmount0Focused(true)}
              onBlur={() => ctx.setIsAmount0Focused(false)}
              onUseFullBalance={() => handleUseFullBalance(true)}
              onPercentageClick={(pct) => {
                handleToken0Percentage(pct);
                ctx.setActiveInputSide('amount0');
                transaction.reset();
                ctx.setShowingTransactionSteps(false);
              }}
              onZapTokenSwitch={() => {
                if (ctx.zapState.isZapMode && !ctx.uiState.showingTransactionSteps) {
                  ctx.setZapInputToken('token1');
                  ctx.resetZapState();
                  if (ctx.depositState.amount0) {
                    ctx.setAmount1(ctx.depositState.amount0);
                    ctx.setAmount0("");
                    ctx.setActiveInputSide('amount1');
                  }
                }
              }}
              triggerWiggle={ctx.triggerWiggle0}
              getUSDPrice={() => ctx.getUSDPriceForSymbol(ctx.token0Symbol)}
            />
          )}

          {/* Plus Icon */}
          {!ctx.zapState.isZapMode && (
            <div className="flex justify-center relative my-0" style={{ height: '20px' }}>
              <div className={cn("plus-loading-wrapper", ctx.isCalculating && "loading")}>
                <div className="plus-loading-inner">
                  <Plus className="h-4 w-4" />
                </div>
              </div>
            </div>
          )}

          {/* Token 1 Input */}
          {(!ctx.zapState.isZapMode || ctx.zapState.zapInputToken === 'token1') && (
            <div className="mb-4">
              <TokenAmountInput
                tokenSymbol={ctx.token1Symbol}
                amount={ctx.depositState.amount1}
                fullPrecisionAmount={ctx.depositState.amount1FullPrecision}
                balanceData={ctx.token1BalanceData}
                isLoadingBalance={ctx.isLoadingToken1Balance}
                isFocused={ctx.uiState.isAmount1Focused}
                canAdd={ctx.canAddToken1}
                isWorking={transaction.isWorking}
                isCalculating={ctx.isCalculating}
                isConnected={isConnected}
                isZapMode={ctx.zapState.isZapMode}
                showingTransactionSteps={ctx.uiState.showingTransactionSteps}
                isOtherInputActive={ctx.depositState.activeInputSide === 'amount0'}
                calculatedAmountWei={ctx.calculatedData?.amount1}
                tokenDecimals={tokenDefinitions[ctx.token1Symbol]?.decimals || 18}
                wiggleControls={ctx.balanceWiggleControls1}
                onAmountChange={(value) => {
                  ctx.setAmount1FullPrecision("");
                  transaction.reset();
                  ctx.setShowingTransactionSteps(false);
                  ctx.setAmount1(value);
                  ctx.setActiveInputSide('amount1');
                  ctx.setHasUserInteracted(true);
                }}
                onFocus={() => ctx.setIsAmount1Focused(true)}
                onBlur={() => ctx.setIsAmount1Focused(false)}
                onUseFullBalance={() => handleUseFullBalance(false)}
                onPercentageClick={(pct) => {
                  handleToken1Percentage(pct);
                  ctx.setActiveInputSide('amount1');
                  transaction.reset();
                  ctx.setShowingTransactionSteps(false);
                }}
                onZapTokenSwitch={() => {
                  if (ctx.zapState.isZapMode && !ctx.uiState.showingTransactionSteps) {
                    ctx.setZapInputToken('token0');
                    ctx.resetZapState();
                    if (ctx.depositState.amount1) {
                      ctx.setAmount0(ctx.depositState.amount1);
                      ctx.setAmount1("");
                      ctx.setActiveInputSide('amount0');
                    }
                  }
                }}
                triggerWiggle={ctx.triggerWiggle1}
                getUSDPrice={() => ctx.getUSDPriceForSymbol(ctx.token1Symbol)}
              />
            </div>
          )}

          {/* Transaction Flow Panels */}
          {ctx.uiState.showingTransactionSteps && !ctx.zapState.isZapMode && (
            <TransactionFlowPanel
              isActive={ctx.uiState.showingTransactionSteps}
              approvalData={transaction.approvalData}
              isCheckingApprovals={transaction.isCheckingApprovals}
              token0Symbol={ctx.token0Symbol}
              token1Symbol={ctx.token1Symbol}
              isDepositSuccess={transaction.isDepositSuccess}
              onApproveToken={transaction.handleApprove}
              onSignPermit={signPermit}
              onExecute={transaction.handleDeposit}
              onRefetchApprovals={transaction.refetchApprovals}
              onBack={() => {
                ctx.setShowingTransactionSteps(false);
                transaction.reset();
              }}
              onReset={transaction.reset}
              executeButtonLabel="Deposit"
              showBackButton={true}
              autoProgressOnApproval={false}
              calculatedData={ctx.calculatedData}
              tickLower={ctx.rangeState.tickLower}
              tickUpper={ctx.rangeState.tickUpper}
              amount0={ctx.depositState.amount0}
              amount1={ctx.depositState.amount1}
              currentPrice={ctx.poolState.currentPrice}
              currentPoolTick={ctx.poolState.currentPoolTick}
              currentPoolSqrtPriceX96={ctx.poolState.currentPoolSqrtPriceX96}
              selectedPoolId={selectedPoolId}
              getUsdPriceForSymbol={ctx.getUSDPriceForSymbol}
              convertTickToPrice={convertTickToPrice}
            />
          )}

          {ctx.uiState.showingTransactionSteps && ctx.zapState.isZapMode && (
            <TransactionFlowPanel
              isActive={ctx.uiState.showingTransactionSteps}
              approvalData={transaction.approvalData}
              isCheckingApprovals={transaction.isCheckingApprovals}
              token0Symbol={ctx.token0Symbol}
              token1Symbol={ctx.token1Symbol}
              isDepositSuccess={transaction.isDepositSuccess}
              isZapMode={true}
              zapInputToken={ctx.zapState.zapInputToken}
              onApproveToken={transaction.handleApprove}
              onSignPermit={signPermit}
              onExecuteZap={transaction.handleZapSwapAndDeposit}
              onExecute={transaction.handleDeposit}
              onRefetchApprovals={transaction.refetchApprovals}
              onBack={() => {
                ctx.setShowingTransactionSteps(false);
                transaction.reset();
              }}
              onReset={transaction.reset}
              executeButtonLabel="Execute Zap"
              showBackButton={true}
              autoProgressOnApproval={false}
              slippageControl={
                <SlippageControl
                  currentSlippage={ctx.currentSlippage}
                  isAuto={ctx.isAutoSlippage}
                  autoSlippage={ctx.autoSlippageValue}
                  onSlippageChange={ctx.setSlippage}
                  onAutoToggle={ctx.setAutoMode}
                  onCustomToggle={ctx.setCustomMode}
                />
              }
              priceImpactWarning={ctx.priceImpactWarning}
              calculatedData={ctx.calculatedData}
              tickLower={ctx.rangeState.tickLower}
              tickUpper={ctx.rangeState.tickUpper}
              amount0={ctx.depositState.amount0}
              amount1={ctx.depositState.amount1}
              currentPrice={ctx.poolState.currentPrice}
              currentPoolTick={ctx.poolState.currentPoolTick}
              currentPoolSqrtPriceX96={ctx.poolState.currentPoolSqrtPriceX96}
              selectedPoolId={selectedPoolId}
              getUsdPriceForSymbol={ctx.getUSDPriceForSymbol}
              convertTickToPrice={convertTickToPrice}
              zapQuote={ctx.zapQuote}
              currentSlippage={ctx.currentSlippage}
            />
          )}

          {/* Action Button */}
          {!isConnected ? (
            <div
              className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
              style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              {/* @ts-expect-error custom element provided by wallet kit */}
              <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
              <span className="relative z-0 pointer-events-none">Connect Wallet</span>
            </div>
          ) : !ctx.uiState.showingTransactionSteps ? (
            <Button
              className={cn(
                "w-full",
                (transaction.isWorking || ctx.isCalculating || ctx.poolState.isPoolStateLoading || transaction.isCheckingApprovals ||
                !ctx.hasRangeSelected ||
                (!parseFloat(ctx.depositState.amount0 || "0") && !parseFloat(ctx.depositState.amount1 || "0")) ||
                isInsufficientBalance)
                  ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                  : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              )}
              onClick={async () => {
                if (!ctx.hasRangeSelected) {
                  showErrorToast("Select Range", { description: "Please select a price range first" });
                  return;
                }
                if (isInsufficientBalance) {
                  showErrorToast("Insufficient Balance");
                  return;
                }
                if (parseFloat(ctx.depositState.amount0 || "0") <= 0 && parseFloat(ctx.depositState.amount1 || "0") <= 0) {
                  showErrorToast("Invalid Amount", { description: "Must be greater than 0" });
                  return;
                }

                if (ctx.zapState.isZapMode) {
                  const inputAmount = ctx.zapState.zapInputToken === 'token0' ? ctx.depositState.amount0 : ctx.depositState.amount1;
                  if (!inputAmount || parseFloat(inputAmount) <= 0) {
                    showErrorToast("Invalid Amount", { description: "Must provide input amount" });
                    return;
                  }

                  try {
                    const success = await ctx.fetchZapQuote({
                      zapInputToken: ctx.zapState.zapInputToken,
                      inputAmount,
                      tickLower: ctx.rangeState.tickLower,
                      tickUpper: ctx.rangeState.tickUpper,
                      accountAddress,
                    });
                    if (!success) return;
                  } catch (error: any) {
                    if (error.message?.includes('Price impact') || error.message?.includes('slippage')) {
                      showErrorToast('Slippage Protection', { description: error.message });
                    } else {
                      showErrorToast('Failed to calculate zap quote', { description: error.message });
                    }
                    return;
                  }
                }

                ctx.setShowingTransactionSteps(true);
              }}
              disabled={
                transaction.isWorking ||
                ctx.isCalculating ||
                ctx.isPreparingZap ||
                ctx.poolState.isPoolStateLoading ||
                transaction.isCheckingApprovals ||
                !ctx.hasRangeSelected ||
                (!parseFloat(ctx.depositState.amount0 || "0") && !parseFloat(ctx.depositState.amount1 || "0")) ||
                isInsufficientBalance
              }
              style={
                (transaction.isWorking || ctx.isCalculating || ctx.isPreparingZap || ctx.poolState.isPoolStateLoading || transaction.isCheckingApprovals ||
                !ctx.hasRangeSelected ||
                (!parseFloat(ctx.depositState.amount0 || "0") && !parseFloat(ctx.depositState.amount1 || "0")) ||
                isInsufficientBalance)
                  ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }
                  : undefined
              }
            >
              <span className={cn((ctx.isCalculating || ctx.poolState.isPoolStateLoading) ? "animate-pulse" : "")}>
                {!ctx.hasRangeSelected ? 'Select Range' : isInsufficientBalance ? 'Insufficient Balance' : 'Deposit'}
              </span>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
