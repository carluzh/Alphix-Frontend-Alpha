"use client";

import React, { useCallback, useMemo, useEffect, useRef } from "react";
import { TokenImage } from "@/components/ui/token-image";
import { useAnimation } from "framer-motion";
import { useAccount } from "wagmi";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { chainIdForMode } from "@/lib/network-mode";
import { clearCachedPermit } from "@/lib/permit-types";
import { invalidateAfterTx } from "@/lib/apollo/mutations/invalidation";
import { reportMessage } from "@/lib/observability";
import { useChainMismatch } from "@/hooks/useChainMismatch";
import { getPoolBySlug } from "@/lib/pools-config";
import { usePoolState } from "@/lib/apollo/hooks/usePoolState";
import { usePriceDeviation, type DeviationThresholds } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout } from "@/components/ui/PriceDeviationCallout";
import { formatCalculatedAmount, getTokenIcon } from "../liquidity-form-utils";
import { DepositInputForm, type PositionField } from "../shared/DepositInputForm";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";

import { TransactionModal } from "@/components/transactions/TransactionModal";
import { IncreaseLiquidityContextProvider, useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { IncreaseLiquidityTxContextProvider, useIncreaseLiquidityTxContext } from "./IncreaseLiquidityTxContext";

import { useLiquidityExecutors } from "@/lib/transactions/flows/useLiquidityExecutors";
import { generateLPTransactionSteps } from "@/lib/liquidity/transaction";
import { collapseToBatchedAsync } from "@/lib/liquidity/transaction/steps/collapseBatchedSteps";
import { useCanBatchCalls } from "@/lib/transactions/useCanBatchCalls";
import type { ValidatedLiquidityTxContext, TransactionStep } from "@/lib/liquidity/types";
import { TransactionStepType as UIStepType, type TransactionStep as UITransactionStep } from "@/lib/transactions/types";
import type { StepGenerationResult } from "@/lib/transactions/useStepExecutor";

interface IncreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const SLIPPAGE_DEVIATION_THRESHOLDS: DeviationThresholds = { LOW: 1, MEDIUM: 5, HIGH: 5 };

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
      case "UnifiedYieldApproval": {
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
      case "IncreasePositionTransaction":
      case "IncreasePositionTransactionAsync":
      case "IncreasePositionTransactionBatchedAsync":
      case "UnifiedYieldDeposit":
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
    fetchAndBuildContext,
  } = useIncreaseLiquidityTxContext();

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      resetForm();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, resetForm]);

  const { position } = increaseLiquidityState;
  const networkMode = position.networkMode;
  const chainId = networkMode ? chainIdForMode(networkMode) : undefined;
  const { formattedAmounts } = derivedIncreaseLiquidityInfo;
  const canBatchCalls = useCanBatchCalls(chainId);

  const poolConfig = useMemo(
    () => (position.poolId ? getPoolBySlug(position.poolId, networkMode) : null),
    [position.poolId, networkMode],
  );
  const { data: poolStateData } = usePoolState(poolConfig?.poolId ?? '', networkMode);
  const priceDeviation = usePriceDeviation(
    {
      token0Symbol: position.token0.symbol,
      token1Symbol: position.token1.symbol,
      poolPrice: poolStateData?.currentPrice ?? null,
    },
    SLIPPAGE_DEVIATION_THRESHOLDS,
  );

  const isOutOfRange = !position.isInRange;
  let deposit0Disabled = false;
  let deposit1Disabled = false;
  if (isOutOfRange) {
    const amt0 = parseFloat(position.token0?.amount || "0");
    const amt1 = parseFloat(position.token1?.amount || "0");
    if (amt0 > 0 && amt1 <= 0) deposit1Disabled = true;
    else if (amt1 > 0 && amt0 <= 0) deposit0Disabled = true;
  }

  const amount0 = parseFloat(formattedAmounts?.TOKEN0 || "0");
  const amount1 = parseFloat(formattedAmounts?.TOKEN1 || "0");
  const currentToken0Amount = parseFloat(position.token0.amount || "0");
  const currentToken1Amount = parseFloat(position.token1.amount || "0");
  const projectedToken0Amount = currentToken0Amount + amount0;
  const projectedToken1Amount = currentToken1Amount + amount1;
  const showProjected = amount0 > 0 || amount1 > 0;

  const txContextRef = useRef<ValidatedLiquidityTxContext | null>(null);
  const liquidityExecutors = useLiquidityExecutors(txContextRef);

  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    const context = await fetchAndBuildContext();
    if (!context) throw new Error("Failed to build transaction context");
    txContextRef.current = context;
    const rawSteps = generateLPTransactionSteps(context);
    if (rawSteps.length === 0) {
      throw new Error("Transaction context produced no executable steps. Refresh and try again.");
    }
    const steps = canBatchCalls ? collapseToBatchedAsync(rawSteps as TransactionStep[]) : rawSteps;
    return { steps };
  }, [fetchAndBuildContext, canBatchCalls]);

  const mapStepsToUIFn = useCallback((steps: unknown[]): UITransactionStep[] => {
    return mapStepsToUI(
      steps,
      position.token0.symbol,
      position.token1.symbol,
      getTokenIcon(position.token0.symbol, networkMode),
      getTokenIcon(position.token1.symbol, networkMode),
    );
  }, [position.token0.symbol, position.token1.symbol, networkMode]);

  const onBeforeExecute = useCallback(async () => {
    if (chainId) {
      const ok = await ensureChain(chainId);
      if (!ok) return false;
    }
    return true;
  }, [chainId, ensureChain]);

  const handleSuccess = useCallback((results: Map<number, any>) => {
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
    // Kick off Apollo refetch BEFORE the parent's onSuccess so consumers re-render
    // against fresh user-positions. invalidateAfterTx implements Uniswap's 2-layer
    // pattern (3s delayed refetchQueries({include:'active'})).
    if (address && chainId) {
      invalidateAfterTx({ owner: address, chainId }).catch((err) =>
        reportMessage('post-tx refetch failed', {
          domain: 'liquidity',
          action: 'refetchPositions',
          level: 'warning',
          component: 'IncreaseLiquidityModal',
          chainId,
          extras: { refetchError: err instanceof Error ? err.message : String(err) },
        }),
      );
    }
    onSuccess?.();
  }, [onSuccess, address, chainId, networkMode, position.token0.symbol, position.token1.symbol]);

  const handleUserInput = (field: PositionField, value: string) => {
    if (field === "TOKEN0") setAmount0(value);
    else setAmount1(value);
  };

  const hasInsufficientBalance = isOverBalance0 || isOverBalance1;

  const isDisabled =
    !hasValidAmounts ||
    hasInsufficientBalance ||
    isCalculating ||
    isLoading;

  const buttonText = hasInsufficientBalance ? "Insufficient Balance" : "Add Liquidity";

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
    >
      <div className="space-y-4">
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

        <PriceDeviationCallout
          deviation={priceDeviation}
          token0Symbol={position.token0.symbol}
          token1Symbol={position.token1.symbol}
          variant="card"
        />

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
