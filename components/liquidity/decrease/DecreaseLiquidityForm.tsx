"use client";

import React, { useCallback } from "react";
import { motion, useAnimation } from "framer-motion";
import Image from "next/image";
import { IconPlus } from "nucleo-micro-bold-essential";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatTokenDisplayAmount, sanitizeDecimalInput } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import { getTokenIcon } from "../liquidity-form-utils";
import { LiquidityPositionInfo } from "../shared/LiquidityPositionInfo";
import { useDecreaseLiquidityContext, DecreaseLiquidityStep } from "./DecreaseLiquidityContext";
import { useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";

export function DecreaseLiquidityForm() {
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  const {
    setStep,
    decreaseLiquidityState,
    derivedDecreaseInfo,
    setWithdrawAmount0,
    setWithdrawAmount1,
    setActiveInputSide,
    setIsFullWithdraw,
    hasValidAmounts,
    isAmount0OverBalance,
    isAmount1OverBalance,
  } = useDecreaseLiquidityContext();

  const {
    isWorking,
    token0USDPrice,
    token1USDPrice,
    calculateWithdrawAmount,
  } = useDecreaseLiquidityTxContext();

  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1, isCalculating } = derivedDecreaseInfo;

  const handleAmountChange = useCallback((value: string, side: "amount0" | "amount1") => {
    const sanitized = sanitizeDecimalInput(value);
    const maxAmount = side === "amount0" ? parseFloat(position.token0.amount) : parseFloat(position.token1.amount);
    const inputAmount = parseFloat(sanitized || "0");
    const prevAmount = side === "amount0" ? parseFloat(withdrawAmount0 || "0") : parseFloat(withdrawAmount1 || "0");

    const wasOver = Number.isFinite(prevAmount) && prevAmount > maxAmount;
    const isOver = Number.isFinite(inputAmount) && inputAmount > maxAmount;

    if (isOver && !wasOver) {
      if (side === "amount0") wiggleControls0.start({ x: [0, -3, 3, -2, 2, 0], transition: { duration: 0.22 } });
      else wiggleControls1.start({ x: [0, -3, 3, -2, 2, 0], transition: { duration: 0.22 } });
    }

    if (side === "amount0") {
      setWithdrawAmount0(sanitized);
      setActiveInputSide("amount0");
      if (sanitized && parseFloat(sanitized) > 0) {
        calculateWithdrawAmount(sanitized, "amount0");
        setIsFullWithdraw(parseFloat(sanitized) >= maxAmount * 0.99);
      } else {
        setWithdrawAmount1("");
        setIsFullWithdraw(false);
      }
    } else {
      setWithdrawAmount1(sanitized);
      setActiveInputSide("amount1");
      if (sanitized && parseFloat(sanitized) > 0) {
        calculateWithdrawAmount(sanitized, "amount1");
        setIsFullWithdraw(parseFloat(sanitized) >= maxAmount * 0.99);
      } else {
        setWithdrawAmount0("");
        setIsFullWithdraw(false);
      }
    }
  }, [position, withdrawAmount0, withdrawAmount1, setWithdrawAmount0, setWithdrawAmount1, setActiveInputSide, setIsFullWithdraw, calculateWithdrawAmount, wiggleControls0, wiggleControls1]);

  const handleMaxWithdraw = useCallback((side: "amount0" | "amount1") => {
    const maxAmount = side === "amount0" ? position.token0.amount : position.token1.amount;
    if (side === "amount0") {
      setWithdrawAmount0(maxAmount);
      setActiveInputSide("amount0");
      calculateWithdrawAmount(maxAmount, "amount0");
    } else {
      setWithdrawAmount1(maxAmount);
      setActiveInputSide("amount1");
      calculateWithdrawAmount(maxAmount, "amount1");
    }
    setIsFullWithdraw(true);
  }, [position, setWithdrawAmount0, setWithdrawAmount1, setActiveInputSide, setIsFullWithdraw, calculateWithdrawAmount]);

  const handleContinue = () => {
    if (hasValidAmounts && !isAmount0OverBalance && !isAmount1OverBalance) {
      setStep(DecreaseLiquidityStep.Review);
    }
  };

  const isDisabled = !hasValidAmounts || isAmount0OverBalance || isAmount1OverBalance || isCalculating || isWorking;
  const buttonText = isCalculating ? "Calculating..." : isAmount0OverBalance || isAmount1OverBalance ? "Insufficient Balance" : "Continue";

  return (
    <div className="space-y-4">
      <LiquidityPositionInfo
        position={{ token0Symbol: position.token0.symbol, token1Symbol: position.token1.symbol, isInRange: position.isInRange }}
        isMiniVersion
        showFeeTier={false}
      />

      <div className="space-y-3">
        {position.isInRange ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Withdraw</Label>
                <button type="button" className="text-xs text-muted-foreground hover:text-white transition-colors border-0" onClick={() => handleMaxWithdraw("amount0")} disabled={isWorking}>
                  Balance: {formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                </button>
              </div>
              <motion.div className="relative group rounded-lg bg-surface border border-sidebar-border/60 p-4" animate={wiggleControls0}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                    <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
                    <span className="text-sm font-medium">{position.token0.symbol}</span>
                  </div>
                  <div className="flex-1">
                    <Input placeholder="0.0" value={withdrawAmount0} onChange={(e) => handleAmountChange(e.target.value, "amount0")} disabled={isWorking} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 p-0 h-auto" />
                    <div className="text-right text-xs text-muted-foreground">{formatUSD(parseFloat(withdrawAmount0 || "0") * token0USDPrice)}</div>
                  </div>
                </div>
              </motion.div>
            </div>

            <div className="flex justify-center items-center my-2">
              <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                <IconPlus className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Withdraw</Label>
                <button type="button" className="text-xs text-muted-foreground hover:text-white transition-colors border-0" onClick={() => handleMaxWithdraw("amount1")} disabled={isWorking}>
                  Balance: {formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                </button>
              </div>
              <motion.div className="relative group rounded-lg bg-surface border border-sidebar-border/60 p-4" animate={wiggleControls1}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                    <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
                    <span className="text-sm font-medium">{position.token1.symbol}</span>
                  </div>
                  <div className="flex-1">
                    <Input placeholder="0.0" value={withdrawAmount1} onChange={(e) => handleAmountChange(e.target.value, "amount1")} disabled={isWorking} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 p-0 h-auto" />
                    <div className="text-right text-xs text-muted-foreground">{formatUSD(parseFloat(withdrawAmount1 || "0") * token1USDPrice)}</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        ) : (
          <>
            {parseFloat(position.token0.amount) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Withdraw {position.token0.symbol}</Label>
                  <button type="button" className="text-xs text-muted-foreground hover:text-white transition-colors border-0" onClick={() => handleMaxWithdraw("amount0")} disabled={isWorking}>
                    Balance: {formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                  </button>
                </div>
                <motion.div className="relative rounded-lg bg-surface border border-sidebar-border/60 p-4" animate={wiggleControls0}>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                      <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{position.token0.symbol}</span>
                    </div>
                    <div className="flex-1">
                      <Input placeholder="0.0" value={withdrawAmount0} onChange={(e) => handleAmountChange(e.target.value, "amount0")} disabled={isWorking} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 p-0 h-auto" />
                      <div className="text-right text-xs text-muted-foreground">{formatUSD(parseFloat(withdrawAmount0 || "0") * token0USDPrice)}</div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
            {parseFloat(position.token1.amount) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Withdraw {position.token1.symbol}</Label>
                  <button type="button" className="text-xs text-muted-foreground hover:text-white transition-colors border-0" onClick={() => handleMaxWithdraw("amount1")} disabled={isWorking}>
                    Balance: {formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                  </button>
                </div>
                <motion.div className="relative rounded-lg bg-surface border border-sidebar-border/60 p-4" animate={wiggleControls1}>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                      <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{position.token1.symbol}</span>
                    </div>
                    <div className="flex-1">
                      <Input placeholder="0.0" value={withdrawAmount1} onChange={(e) => handleAmountChange(e.target.value, "amount1")} disabled={isWorking} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 p-0 h-auto" />
                      <div className="text-right text-xs text-muted-foreground">{formatUSD(parseFloat(withdrawAmount1 || "0") * token1USDPrice)}</div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </>
        )}
      </div>

      <Button
        onClick={handleContinue}
        disabled={isDisabled}
        className={cn("w-full", isDisabled ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90")}
        style={isDisabled ? { backgroundImage: "url(/pattern_wide.svg)", backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        <span className={isCalculating ? "animate-pulse" : ""}>{buttonText}</span>
      </Button>
    </div>
  );
}
