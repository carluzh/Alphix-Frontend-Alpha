"use client";

/**
 * IncreaseLiquidityForm - Input UI for increase liquidity flow
 *
 * Following Uniswap's pattern: Uses both UI and TX contexts,
 * renders shared DepositInputForm with callbacks.
 *
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityForm.tsx
 */

import React from "react";
import { useAnimation } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCalculatedAmount } from "../liquidity-form-utils";
import { DepositInputForm, type PositionField } from "../shared/DepositInputForm";
import { LiquidityDetailRows } from "../shared/LiquidityDetailRows";
import { LiquidityPositionInfo } from "../shared/LiquidityPositionInfo";
import {
  useIncreaseLiquidityContext,
  IncreaseLiquidityStep,
} from "./IncreaseLiquidityContext";
import { useIncreaseLiquidityTxContext } from "./IncreaseLiquidityTxContext";

export function IncreaseLiquidityForm() {
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  const {
    setStep,
    increaseLiquidityState,
    derivedIncreaseLiquidityInfo,
    setAmount0,
    setAmount1,
    hasValidAmounts,
    isOverBalance0,
    isOverBalance1,
  } = useIncreaseLiquidityContext();

  const {
    prepareTransaction,
    token0Balance,
    token1Balance,
    token0USDPrice,
    token1USDPrice,
    handlePercentage0,
    handlePercentage1,
    calculateDependentAmount,
    isCalculating,
    isWorking,
  } = useIncreaseLiquidityTxContext();

  const { position } = increaseLiquidityState;
  const { formattedAmounts } = derivedIncreaseLiquidityInfo;

  // Determine deposit disabled states based on position range
  const isOutOfRange = !position.isInRange;
  let deposit0Disabled = false;
  let deposit1Disabled = false;

  if (isOutOfRange) {
    const amt0 = parseFloat(position.token0?.amount || "0");
    const amt1 = parseFloat(position.token1?.amount || "0");
    // When out of range, only one side is productive
    if (amt0 > 0 && amt1 <= 0) {
      deposit1Disabled = true;
    } else if (amt1 > 0 && amt0 <= 0) {
      deposit0Disabled = true;
    }
  }

  // Handle user input
  const handleUserInput = (field: PositionField, value: string) => {
    if (field === "TOKEN0") {
      setAmount0(value);
    } else {
      setAmount1(value);
    }
  };

  // Handle continue to review
  const handleContinue = async () => {
    await prepareTransaction();
    setStep(IncreaseLiquidityStep.Review);
  };

  // Button state
  const isDisabled =
    !hasValidAmounts ||
    isOverBalance0 ||
    isOverBalance1 ||
    isCalculating ||
    isWorking;

  const buttonText = isCalculating
    ? "Calculating..."
    : isOverBalance0 || isOverBalance1
    ? "Insufficient Balance"
    : "Continue";

  return (
    <div className="space-y-4">
      {/* Position Info Header */}
      <LiquidityPositionInfo
        position={{
          token0Symbol: position.token0.symbol,
          token1Symbol: position.token1.symbol,
          feeTier: position.feeTier,
          isInRange: position.isInRange,
        }}
        isMiniVersion
      />

      {/* Deposit Input Form */}
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

      {/* Detail Rows (preview) */}
      {hasValidAmounts && (
        <LiquidityDetailRows
          token0Amount={formattedAmounts?.TOKEN0}
          token0Symbol={position.token0.symbol}
          token1Amount={formattedAmounts?.TOKEN1}
          token1Symbol={position.token1.symbol}
          token0USDValue={
            parseFloat(formattedAmounts?.TOKEN0 || "0") * token0USDPrice
          }
          token1USDValue={
            parseFloat(formattedAmounts?.TOKEN1 || "0") * token1USDPrice
          }
          showNetworkCost={false}
          title="You will add"
        />
      )}

      {/* Continue Button */}
      <Button
        onClick={handleContinue}
        disabled={isDisabled}
        className={cn(
          "w-full",
          isDisabled
            ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75"
            : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
        )}
        style={
          isDisabled
            ? {
                backgroundImage: "url(/pattern_wide.svg)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        <span className={isCalculating ? "animate-pulse" : ""}>{buttonText}</span>
      </Button>
    </div>
  );
}
