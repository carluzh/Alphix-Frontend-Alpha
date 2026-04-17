"use client";

/**
 * DecreaseLiquidityModal - Uses shared TransactionModal
 *
 * Wraps context providers around TransactionModal. The form content
 * (percentage selector, "you will receive", position display) is
 * rendered as TransactionModal children. All execution logic is
 * delegated to TransactionModal + useDecreaseLiquidityFlow.
 *
 * @see components/transactions/TransactionModal.tsx
 * @see lib/transactions/flows/useDecreaseLiquidityFlow.ts
 */

import React, { useState, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { useAccount } from "wagmi";
import { TokenImage } from "@/components/ui/token-image";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { getTokenIcon } from "../liquidity-form-utils";
import { PositionAmountsDisplay } from "../shared/PositionAmountsDisplay";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";
import { getPoolBySlug } from "@/lib/pools-config";

import { TransactionModal } from "@/components/transactions/TransactionModal";
import { DecreaseLiquidityContextProvider, useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";
import { DecreaseLiquidityTxContextProvider, useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import { useDecreaseLiquidityFlow } from "@/lib/transactions/flows/useDecreaseLiquidityFlow";

// =============================================================================
// TYPES
// =============================================================================

interface DecreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (options?: { isFullBurn?: boolean }) => void;
}

// =============================================================================
// PERCENTAGE OPTIONS
// =============================================================================

const PERCENTAGE_OPTIONS = [25, 50, 75, 100];

// =============================================================================
// INNER COMPONENT (uses contexts)
// =============================================================================

function DecreaseLiquidityInner({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (options?: { isFullBurn?: boolean }) => void;
}) {
  const { address } = useAccount();

  const {
    decreaseLiquidityState,
    derivedDecreaseInfo,
    setWithdrawAmount0,
    setWithdrawAmount1,
    setIsFullWithdraw,
    hasValidAmounts,
    isUnifiedYield,
  } = useDecreaseLiquidityContext();

  const {
    isLoading,
    token0USDPrice,
    token1USDPrice,
    fetchAndBuildContext,
  } = useDecreaseLiquidityTxContext();

  const { position } = decreaseLiquidityState;
  const networkMode = position.networkMode;

  // Percentage state
  const [percent, setPercent] = useState<number>(0);
  const percentRef = useRef<number>(0);
  const [percentStr, setPercentStr] = useState<string>("");

  // Dynamic width measurement for percentage input
  const hiddenSpanRef = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState<number>(0);

  useLayoutEffect(() => {
    if (hiddenSpanRef.current) {
      const width = hiddenSpanRef.current.offsetWidth;
      setInputWidth(width > 0 ? width + 1 : 0);
    }
  }, [percentStr]);

  // Position balances
  const positionBalance0 = parseFloat(position.token0.amount || "0");
  const positionBalance1 = parseFloat(position.token1.amount || "0");

  // Computed amounts
  const amount0 = (positionBalance0 * percent) / 100;
  const amount1 = (positionBalance1 * percent) / 100;
  const projectedToken0Amount = Math.max(0, positionBalance0 - amount0);
  const projectedToken1Amount = Math.max(0, positionBalance1 - amount1);
  const showProjected = percent > 0;

  // Handle percentage selection
  const handlePercentageSelect = useCallback((selectedPercent: number) => {
    setPercent(selectedPercent);
    percentRef.current = selectedPercent;
    setPercentStr(selectedPercent.toString());

    const calcAmount0 = (positionBalance0 * selectedPercent) / 100;
    const calcAmount1 = (positionBalance1 * selectedPercent) / 100;

    setWithdrawAmount0(calcAmount0.toString());
    setWithdrawAmount1(calcAmount1.toString());
    setIsFullWithdraw(selectedPercent >= 99);
  }, [positionBalance0, positionBalance1, setWithdrawAmount0, setWithdrawAmount1, setIsFullWithdraw]);

  // Flow definition
  const { generateSteps, executors, mapStepsToUI } = useDecreaseLiquidityFlow({
    fetchAndBuildContext,
    token0Symbol: position.token0.symbol,
    token1Symbol: position.token1.symbol,
    token0Icon: getTokenIcon(position.token0.symbol, networkMode),
    token1Icon: getTokenIcon(position.token1.symbol, networkMode),
  });

  // Success handler
  const handleSuccess = useCallback((results: Map<number, { txHash?: string }>) => {
    const isFullBurn = percentRef.current >= 99;
    const msg = isFullBurn ? "Position closed" : "Liquidity withdrawn";

    // Extract last tx hash for explorer link
    let hash: string | undefined;
    for (const [, result] of results) {
      if (result.txHash) hash = result.txHash;
    }

    if (hash) {
      toast.success(msg, {
        action: { label: "View transaction", onClick: () => window.open(getExplorerTxUrl(hash!), "_blank") },
      });
    } else {
      toast.success(msg);
    }

    onSuccess?.({ isFullBurn });
  }, [onSuccess]);

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

        {/* Percentage Selector */}
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
                    if (val === "" || (parseInt(val, 10) <= 100)) {
                      setPercentStr(val);
                      const num = val === "" ? 0 : parseInt(val, 10);
                      if (num === 0) {
                        setPercent(0);
                        percentRef.current = 0;
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

          {/* You Will Receive */}
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
                      <span className={cn("text-sm font-medium tabular-nums", amount0 === 0 && "text-muted-foreground")}>
                        {formatTokenDisplayAmount(amount0.toString(), position.token0.symbol as TokenSymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TokenImage src={getTokenIcon(position.token1.symbol, networkMode)} alt={position.token1.symbol} size={20} />
                        <span className="text-sm font-medium">{position.token1.symbol}</span>
                      </div>
                      <span className={cn("text-sm font-medium tabular-nums", amount1 === 0 && "text-muted-foreground")}>
                        {formatTokenDisplayAmount(amount1.toString(), position.token1.symbol as TokenSymbol)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
          title={showProjected ? "Remaining Position" : "Current Position"}
        />
      </div>
    </TransactionModal>
  );
}

// =============================================================================
// MAIN EXPORT (wraps providers)
// =============================================================================

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
