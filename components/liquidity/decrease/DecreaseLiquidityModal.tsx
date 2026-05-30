"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { TokenImage } from "@/components/ui/token-image";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { chainIdForMode } from "@/lib/network-mode";
import { invalidateAfterTx } from "@/lib/apollo/mutations/invalidation";
import { reportMessage } from "@/lib/observability";
import { getTokenIcon } from "../liquidity-form-utils";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import { LiquidityModalHeader } from "../shared/LiquidityModalHeader";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";
import { getPoolBySlug, getTokenDefinitions } from "@/lib/pools-config";
import { usePoolState } from "@/lib/apollo/hooks/usePoolState";
import { usePriceDeviation, type DeviationThresholds } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout } from "@/components/ui/PriceDeviationCallout";

import { TransactionModal } from "@/components/transactions/TransactionModal";
import { DecreaseLiquidityContextProvider, useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";
import { DecreaseLiquidityTxContextProvider, useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import { useDecreaseLiquidityFlow } from "@/lib/transactions/flows/useDecreaseLiquidityFlow";

interface DecreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (options?: { isFullBurn?: boolean }) => void;
}

const PERCENTAGE_OPTIONS = [25, 50, 75, 100];

const SLIPPAGE_DEVIATION_THRESHOLDS: DeviationThresholds = { LOW: 1, MEDIUM: 5, HIGH: 5 };

function DecreaseLiquidityInner({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (options?: { isFullBurn?: boolean }) => void;
}) {
  const {
    position,
    setWithdrawAmount0,
    setWithdrawAmount1,
    hasValidAmounts,
    isUnifiedYield,
  } = useDecreaseLiquidityContext();

  const { isLoading, fetchAndBuildContext, receive } = useDecreaseLiquidityTxContext();

  const { address } = useAccount();
  const networkMode = position.networkMode;
  const chainId = networkMode ? chainIdForMode(networkMode) : undefined;
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const token0Decimals = tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18;
  const token1Decimals = tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 18;

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

  const [percent, setPercent] = useState<number>(0);
  const percentRef = useRef<number>(0);
  const [percentStr, setPercentStr] = useState<string>("");

  const hiddenSpanRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState<number>(0);

  useLayoutEffect(() => {
    if (hiddenSpanRef.current) {
      const width = hiddenSpanRef.current.offsetWidth;
      setInputWidth(width > 0 ? width + 1 : 0);
    }
  }, [percentStr]);

  const positionBalance0 = parseFloat(position.token0.amount || "0");
  const positionBalance1 = parseFloat(position.token1.amount || "0");

  const projectedToken0Amount = Math.max(0, positionBalance0 * (1 - percent / 100));
  const projectedToken1Amount = Math.max(0, positionBalance1 * (1 - percent / 100));
  const showProjected = percent > 0;

  const applyPercent = useCallback((selectedPercent: number) => {
    const clamped = Math.max(0, Math.min(100, selectedPercent));
    setPercent(clamped);
    percentRef.current = clamped;
    setPercentStr(clamped === 0 ? "" : clamped.toString());
    setWithdrawAmount0(((positionBalance0 * clamped) / 100).toString());
    setWithdrawAmount1(((positionBalance1 * clamped) / 100).toString());
  }, [positionBalance0, positionBalance1, setWithdrawAmount0, setWithdrawAmount1]);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      applyPercent(0);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, applyPercent]);

  const useApi = !isUnifiedYield && !!receive && receive.percent === Math.round(percent);
  const receive0 = useApi
    ? formatTokenDisplayAmount(formatUnits(BigInt(receive!.amount0), token0Decimals), position.token0.symbol as TokenSymbol)
    : formatTokenDisplayAmount(((positionBalance0 * percent) / 100).toString(), position.token0.symbol as TokenSymbol);
  const receive1 = useApi
    ? formatTokenDisplayAmount(formatUnits(BigInt(receive!.amount1), token1Decimals), position.token1.symbol as TokenSymbol)
    : formatTokenDisplayAmount(((positionBalance1 * percent) / 100).toString(), position.token1.symbol as TokenSymbol);

  const handlePercentageSelect = useCallback((selectedPercent: number) => {
    applyPercent(selectedPercent);
  }, [applyPercent]);

  const { generateSteps, executors, mapStepsToUI } = useDecreaseLiquidityFlow({
    fetchAndBuildContext,
    token0Symbol: position.token0.symbol,
    token1Symbol: position.token1.symbol,
    token0Icon: getTokenIcon(position.token0.symbol, networkMode),
    token1Icon: getTokenIcon(position.token1.symbol, networkMode),
  });

  const handleSuccess = useCallback((results: Map<number, { txHash?: string }>) => {
    const isFullBurn = percentRef.current >= 99;
    const msg = isFullBurn ? "Position closed" : "Liquidity withdrawn";

    let hash: string | undefined;
    for (const [, result] of results) {
      if (result.txHash) hash = result.txHash;
    }

    if (hash) {
      toast.success(msg, {
        action: { label: "View transaction", onClick: () => window.open(getExplorerTxUrl(hash!, networkMode), "_blank") },
      });
    } else {
      toast.success(msg);
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
          component: 'DecreaseLiquidityModal',
          chainId,
          extras: { refetchError: err instanceof Error ? err.message : String(err) },
        }),
      );
    }

    onSuccess?.({ isFullBurn });
  }, [onSuccess, networkMode, address, chainId]);

  const isDisabled = percent === 0 || isLoading || !hasValidAmounts;

  return (
    <TransactionModal
      open={isOpen}
      onClose={onClose}
      title="Withdraw Liquidity"
      confirmText={percent === 0 ? "Select amount" : "Withdraw"}
      confirmDisabled={isDisabled}
      generateSteps={generateSteps}
      executors={executors}
      mapStepsToUI={mapStepsToUI}
      onSuccess={handleSuccess}
    >
      <div className="space-y-4">
        <LiquidityModalHeader position={position} isUnifiedYield={isUnifiedYield} networkMode={networkMode} />

        <PriceDeviationCallout
          deviation={priceDeviation}
          token0Symbol={position.token0.symbol}
          token1Symbol={position.token1.symbol}
          variant="card"
        />

        <div className="rounded-xl border border-sidebar-border/60 bg-surface overflow-hidden">
          <div className="px-4 pt-6 pb-4">
            <div className="relative flex items-center justify-center w-full">
              <div className="relative max-w-full" style={{ width: "max-content" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={percentStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, "");
                    if (val === "" || parseInt(val, 10) <= 100) {
                      applyPercent(val === "" ? 0 : parseInt(val, 10));
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
                <span
                  className={cn("select-none", !percentStr ? "text-muted-foreground/50" : "text-foreground")}
                  style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: "70px", fontWeight: 500, lineHeight: "60px" }}
                >
                  %
                </span>
                <span
                  ref={hiddenSpanRef}
                  aria-hidden="true"
                  className="absolute invisible bottom-0 right-0"
                  style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: "70px", fontWeight: 500, lineHeight: "60px", textAlign: "left" }}
                >
                  {percentStr || "0"}
                </span>
              </div>
            </div>

            <div className="flex gap-2 justify-center mt-6">
              {PERCENTAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => handlePercentageSelect(option)}
                  disabled={isLoading}
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

          <AnimatePresence>
            {percent > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="h-px bg-sidebar-border/60" />
                <div className="p-3">
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">You will receive</h4>
                  <div className="rounded-lg border border-sidebar-border/60 bg-surface p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TokenImage src={getTokenIcon(position.token0.symbol, networkMode)} alt={position.token0.symbol} size={20} />
                        <span className="text-sm font-medium">{position.token0.symbol}</span>
                      </div>
                      <span className={cn("text-sm font-medium tabular-nums", parseFloat(receive0) === 0 && "text-muted-foreground")}>
                        {receive0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TokenImage src={getTokenIcon(position.token1.symbol, networkMode)} alt={position.token1.symbol} size={20} />
                        <span className="text-sm font-medium">{position.token1.symbol}</span>
                      </div>
                      <span className={cn("text-sm font-medium tabular-nums", parseFloat(receive1) === 0 && "text-muted-foreground")}>
                        {receive1}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
      </div>
    </TransactionModal>
  );
}

export function DecreaseLiquidityModal({
  position,
  isOpen,
  onClose,
  onSuccess,
}: DecreaseLiquidityModalProps) {
  return (
    <DecreaseLiquidityContextProvider position={position}>
      <DecreaseLiquidityTxContextProvider>
        <DecreaseLiquidityInner isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />
      </DecreaseLiquidityTxContextProvider>
    </DecreaseLiquidityContextProvider>
  );
}

export default DecreaseLiquidityModal;
