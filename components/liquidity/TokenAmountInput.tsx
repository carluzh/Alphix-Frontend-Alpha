"use client";

import React from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import Image from "next/image";
import { formatUnits as viemFormatUnits } from "viem";
import { parseDisplayAmount } from "@/lib/liquidity/utils/parsing/amountParsing";
import { motion, useAnimation } from "framer-motion";
import { formatUSD } from "@/lib/format";
import { getToken } from "@/lib/pools-config";

// Utility function
const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

export interface TokenAmountInputProps {
  tokenSymbol: string;
  amount: string;
  fullPrecisionAmount: string;
  balanceData: { formatted?: string; value?: bigint } | undefined;
  isLoadingBalance: boolean;
  isFocused: boolean;
  canAdd: boolean;
  isWorking: boolean;
  isCalculating: boolean;
  isConnected: boolean;
  isZapMode: boolean;
  showingTransactionSteps: boolean;
  isOtherInputActive: boolean;
  calculatedAmountWei: string | undefined;
  tokenDecimals: number;
  wiggleControls: ReturnType<typeof useAnimation>;
  onAmountChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onUseFullBalance: () => void;
  onPercentageClick: (percentage: number) => void;
  onZapTokenSwitch?: () => void;
  triggerWiggle: () => void;
  getUSDPrice: () => number;
}

export function TokenAmountInput({
  tokenSymbol,
  amount,
  fullPrecisionAmount,
  balanceData,
  isLoadingBalance,
  isFocused,
  canAdd,
  isWorking,
  isCalculating,
  isConnected,
  isZapMode,
  showingTransactionSteps,
  isOtherInputActive,
  calculatedAmountWei,
  tokenDecimals,
  wiggleControls,
  onAmountChange,
  onFocus,
  onBlur,
  onUseFullBalance,
  onPercentageClick,
  onZapTokenSwitch,
  triggerWiggle,
  getUSDPrice,
}: TokenAmountInputProps) {
  const displayBalance = isLoadingBalance ? (
    <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" />
  ) : balanceData ? (
    parseFloat(balanceData.formatted || "0") === 0
      ? "0"
      : parseFloat(balanceData.formatted || "0").toFixed(6)
  ) : (
    "~"
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value.replace(",", ".");
    newValue = newValue.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");

    // Check if going over balance to trigger wiggle
    const maxAmount = balanceData ? parseFloat(balanceData.formatted || "0") : 0;
    const inputAmount = parseFloat(newValue || "0");
    const prevAmount = parseFloat(amount || "0");
    const wasOver =
      Number.isFinite(prevAmount) && Number.isFinite(maxAmount)
        ? prevAmount > maxAmount
        : false;
    const isOver =
      Number.isFinite(inputAmount) && Number.isFinite(maxAmount)
        ? inputAmount > maxAmount
        : false;
    if (isOver && !wasOver) triggerWiggle();

    onAmountChange(newValue);
  };

  const handleFocus = () => {
    onFocus();
    if (
      fullPrecisionAmount &&
      (amount.includes("...") || fullPrecisionAmount !== amount)
    ) {
      onAmountChange(fullPrecisionAmount);
    }
  };

  const handleBlur = () => {
    onBlur();
    if (fullPrecisionAmount && !isOtherInputActive) {
      onAmountChange(formatTokenDisplayAmount(fullPrecisionAmount, tokenSymbol));
    }
  };

  // Calculate USD value
  const usdValue = (() => {
    const usdPrice = getUSDPrice();
    if (calculatedAmountWei) {
      try {
        const preciseAmount = parseFloat(
          viemFormatUnits(BigInt(calculatedAmountWei), tokenDecimals)
        );
        return formatUSD(preciseAmount * usdPrice);
      } catch {
        return formatUSD(parseDisplayAmount(amount) * usdPrice);
      }
    }
    return formatUSD(parseDisplayAmount(amount) * usdPrice);
  })();

  const showPercentageButtons =
    isConnected &&
    balanceData &&
    parseFloat(balanceData.formatted || "0") > 0 &&
    canAdd;

  return (
    <div className="space-y-2">
      <div className="input-gradient-hover">
        <motion.div
          className={cn(
            "relative z-[1] rounded-lg bg-surface p-4 border transition-colors group",
            isFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
          )}
          animate={wiggleControls}
        >
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Amount</Label>
            <Button
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onUseFullBalance}
              disabled={!canAdd || isWorking || isCalculating}
            >
              {displayBalance} {tokenSymbol}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onZapTokenSwitch}
              disabled={!isZapMode || showingTransactionSteps}
              className={cn(
                "flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3 transition-colors",
                isZapMode && !showingTransactionSteps
                  ? "cursor-pointer hover:bg-muted/30"
                  : "cursor-default"
              )}
            >
              <Image
                src={getTokenIcon(tokenSymbol)}
                alt={tokenSymbol}
                width={20}
                height={20}
                className="rounded-full"
              />
              <span className="text-sm font-medium">{tokenSymbol}</span>
              {isZapMode && !showingTransactionSteps && (
                <ArrowLeftRight className="h-3 w-3 text-muted-foreground ml-0.5" />
              )}
            </button>
            <div className="flex-1">
              <Input
                placeholder="0.0"
                value={amount}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                type="text"
                pattern="[0-9]*\.?[0-9]*"
                inputMode="decimal"
                autoComplete="off"
                disabled={!canAdd || isWorking || (isCalculating && isOtherInputActive)}
                className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
              />
              <div className="relative text-right text-xs min-h-5">
                <div
                  className={cn(
                    "text-muted-foreground transition-opacity duration-100",
                    {
                      "group-hover:opacity-0": showPercentageButtons,
                    }
                  )}
                >
                  {usdValue}
                </div>
                {showPercentageButtons && (
                  <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                    {[25, 50, 75, 100].map((percentage, index) => (
                      <motion.div
                        key={percentage}
                        className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                        style={{
                          transitionDelay: `${index * 40}ms`,
                          transitionDuration: "200ms",
                          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPercentageClick(percentage);
                          }}
                        >
                          {percentage === 100 ? "MAX" : `${percentage}%`}
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
