"use client";

import React from "react";
import { IconPlus } from "nucleo-micro-bold-essential";
import { TokenInputCard, TokenInputStyles } from "../TokenInputCard";
import type { AnimationControls } from "framer-motion";

export type PositionField = "TOKEN0" | "TOKEN1";

export interface DepositInfo {
  formattedAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyBalances?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmountsUSDValue?: { TOKEN0?: number; TOKEN1?: number };
}

export interface DepositInputFormProps extends DepositInfo {
  token0Symbol: string;
  token1Symbol: string;
  onUserInput: (field: PositionField, value: string) => void;
  onSetMax?: (field: PositionField, amount: string) => void;
  onCalculateDependentAmount?: (value: string, field: "amount0" | "amount1") => void;
  deposit0Disabled?: boolean;
  deposit1Disabled?: boolean;
  amount0Loading?: boolean;
  amount1Loading?: boolean;
  token0USDPrice?: number;
  token1USDPrice?: number;
  isAmount0OverBalance?: boolean;
  isAmount1OverBalance?: boolean;
  wiggleControls0?: AnimationControls;
  wiggleControls1?: AnimationControls;
  onToken0PercentageClick?: (percentage: number) => string | void;
  onToken1PercentageClick?: (percentage: number) => string | void;
  inputLabel?: string;
  formatUsdAmount?: (amount: number) => React.ReactNode;
  hidePlusIcon?: boolean;
}

export function DepositInputForm({
  token0Symbol,
  token1Symbol,
  formattedAmounts,
  currencyBalances,
  onUserInput,
  onCalculateDependentAmount,
  deposit0Disabled = false,
  deposit1Disabled = false,
  amount0Loading = false,
  amount1Loading = false,
  token0USDPrice = 0,
  token1USDPrice = 0,
  isAmount0OverBalance = false,
  isAmount1OverBalance = false,
  wiggleControls0,
  wiggleControls1,
  onToken0PercentageClick,
  onToken1PercentageClick,
  inputLabel = "Add",
  formatUsdAmount,
  hidePlusIcon = false,
}: DepositInputFormProps) {
  const showBothInputs = !deposit0Disabled && !deposit1Disabled;

  const handleUserInput = (field: PositionField) => (value: string) => {
    onUserInput(field, value);
  };

  const handlePercentageClick = (field: PositionField) => (percentage: number): string | void => {
    if (field === "TOKEN0" && onToken0PercentageClick) return onToken0PercentageClick(percentage);
    if (field === "TOKEN1" && onToken1PercentageClick) return onToken1PercentageClick(percentage);
  };

  const handleCalculateDependentAmount = (field: "amount0" | "amount1") => (value: string) => {
    onCalculateDependentAmount?.(value, field);
  };

  return (
    <div className="space-y-4">
      <TokenInputStyles />
      {!deposit0Disabled && (
        <TokenInputCard
          id="deposit-amount0"
          tokenSymbol={token0Symbol}
          value={formattedAmounts?.TOKEN0 || ""}
          onChange={handleUserInput("TOKEN0")}
          label={inputLabel}
          maxAmount={currencyBalances?.TOKEN0 || "0"}
          usdPrice={token0USDPrice}
          formatUsdAmount={formatUsdAmount}
          isOverBalance={isAmount0OverBalance}
          animationControls={wiggleControls0}
          onPercentageClick={onToken0PercentageClick ? handlePercentageClick("TOKEN0") : undefined}
          onCalculateDependentAmount={onCalculateDependentAmount ? handleCalculateDependentAmount("amount0") : undefined}
          disabled={amount0Loading}
        />
      )}
      {showBothInputs && !hidePlusIcon && (
        <div className="flex justify-center items-center">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
            <IconPlus className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
      {!deposit1Disabled && (
        <TokenInputCard
          id="deposit-amount1"
          tokenSymbol={token1Symbol}
          value={formattedAmounts?.TOKEN1 || ""}
          onChange={handleUserInput("TOKEN1")}
          label={inputLabel}
          maxAmount={currencyBalances?.TOKEN1 || "0"}
          usdPrice={token1USDPrice}
          formatUsdAmount={formatUsdAmount}
          isOverBalance={isAmount1OverBalance}
          animationControls={wiggleControls1}
          onPercentageClick={onToken1PercentageClick ? handlePercentageClick("TOKEN1") : undefined}
          onCalculateDependentAmount={onCalculateDependentAmount ? handleCalculateDependentAmount("amount1") : undefined}
          disabled={amount1Loading}
        />
      )}
    </div>
  );
}
