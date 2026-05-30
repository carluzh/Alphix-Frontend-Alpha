"use client";

import React from "react";
import { IconPlus } from "nucleo-micro-bold-essential";
import { TokenInputCard, TokenInputStyles } from "../TokenInputCard";
import type { AnimationControls } from "framer-motion";

export type PositionField = "TOKEN0" | "TOKEN1";

/**
 * Per-token descriptor for one deposit input row.
 * Replaces the previous flat `token0*`/`token1*` paired props.
 */
export interface TokenInputDescriptor {
  symbol: string;
  /** Current formatted amount; empty string renders the placeholder. */
  amount: string;
  /** Balance / max available; "0" hides the percentage buttons. */
  balance: string;
  usdPrice?: number;
  /** When true the row is hidden entirely (single-sided / out-of-range deposit). */
  disabled?: boolean;
  /** Maps to TokenInputCard.disabled — input is non-interactive while loading. */
  loading?: boolean;
  isOverBalance?: boolean;
  wiggleControls?: AnimationControls;
  onPercentageClick?: (percentage: number) => string | void;
}

export interface DepositInputFormProps {
  token0: TokenInputDescriptor;
  token1: TokenInputDescriptor;
  onUserInput: (field: PositionField, value: string) => void;
  onCalculateDependentAmount?: (value: string, field: "amount0" | "amount1") => void;
  onSetMax?: (field: PositionField, amount: string) => void;
  inputLabel?: string;
  formatUsdAmount?: (amount: number) => React.ReactNode;
  hidePlusIcon?: boolean;
}

export function DepositInputForm({
  token0,
  token1,
  onUserInput,
  onCalculateDependentAmount,
  inputLabel = "Add",
  formatUsdAmount,
  hidePlusIcon = false,
}: DepositInputFormProps) {
  const showBothInputs = !token0.disabled && !token1.disabled;

  const handleUserInput = (field: PositionField) => (value: string) => {
    onUserInput(field, value);
  };

  const handleCalculateDependentAmount = (field: "amount0" | "amount1") => (value: string) => {
    onCalculateDependentAmount?.(value, field);
  };

  return (
    <div className="space-y-4">
      <TokenInputStyles />
      {!token0.disabled && (
        <TokenInputCard
          id="deposit-amount0"
          tokenSymbol={token0.symbol}
          value={token0.amount || ""}
          onChange={handleUserInput("TOKEN0")}
          label={inputLabel}
          maxAmount={token0.balance || "0"}
          usdPrice={token0.usdPrice ?? 0}
          formatUsdAmount={formatUsdAmount}
          isOverBalance={token0.isOverBalance ?? false}
          animationControls={token0.wiggleControls}
          onPercentageClick={token0.onPercentageClick}
          onCalculateDependentAmount={onCalculateDependentAmount ? handleCalculateDependentAmount("amount0") : undefined}
          disabled={token0.loading ?? false}
        />
      )}
      {showBothInputs && !hidePlusIcon && (
        <div className="flex justify-center items-center">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
            <IconPlus className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
      {!token1.disabled && (
        <TokenInputCard
          id="deposit-amount1"
          tokenSymbol={token1.symbol}
          value={token1.amount || ""}
          onChange={handleUserInput("TOKEN1")}
          label={inputLabel}
          maxAmount={token1.balance || "0"}
          usdPrice={token1.usdPrice ?? 0}
          formatUsdAmount={formatUsdAmount}
          isOverBalance={token1.isOverBalance ?? false}
          animationControls={token1.wiggleControls}
          onPercentageClick={token1.onPercentageClick}
          onCalculateDependentAmount={onCalculateDependentAmount ? handleCalculateDependentAmount("amount1") : undefined}
          disabled={token1.loading ?? false}
        />
      )}
    </div>
  );
}
