"use client";

/**
 * DepositInputForm - Shared token input form for liquidity operations
 *
 * Following Uniswap's pattern: Pure presentational component that takes callbacks
 * instead of managing its own state. Reusable across Increase and Create flows.
 *
 * @see interface/apps/web/src/components/Liquidity/DepositInputForm.tsx
 */

import React from "react";
import { PlusIcon } from "lucide-react";
import { TokenInputCard, TokenInputStyles } from "../TokenInputCard";
import type { LegacyAnimationControls } from "motion-dom";

export type PositionField = "TOKEN0" | "TOKEN1";

export interface DepositInfo {
  formattedAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyBalances?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmountsUSDValue?: { TOKEN0?: number; TOKEN1?: number };
}

export interface DepositInputFormProps extends DepositInfo {
  /** Token 0 symbol */
  token0Symbol: string;
  /** Token 1 symbol */
  token1Symbol: string;
  /** Callback when user inputs an amount */
  onUserInput: (field: PositionField, value: string) => void;
  /** Callback when max/percentage is clicked */
  onSetMax?: (field: PositionField, amount: string) => void;
  /** Callback for calculating dependent amount */
  onCalculateDependentAmount?: (value: string, field: "amount0" | "amount1") => void;
  /** Whether token 0 deposit is disabled (e.g., out of range) */
  deposit0Disabled?: boolean;
  /** Whether token 1 deposit is disabled (e.g., out of range) */
  deposit1Disabled?: boolean;
  /** Whether token 0 amount is loading (dependent calculation) */
  amount0Loading?: boolean;
  /** Whether token 1 amount is loading (dependent calculation) */
  amount1Loading?: boolean;
  /** USD prices for tokens */
  token0USDPrice?: number;
  token1USDPrice?: number;
  /** Over balance states for wiggle animation */
  isAmount0OverBalance?: boolean;
  isAmount1OverBalance?: boolean;
  /** Animation controls for wiggle effect */
  wiggleControls0?: LegacyAnimationControls;
  wiggleControls1?: LegacyAnimationControls;
  /** Percentage click handlers */
  onToken0PercentageClick?: (percentage: number) => string | void;
  onToken1PercentageClick?: (percentage: number) => string | void;
  /** Custom label for inputs (default: "Add") */
  inputLabel?: string;
  /** Format USD amount function */
  formatUsdAmount?: (amount: number) => React.ReactNode;
  /** Hide the plus icon between inputs */
  hidePlusIcon?: boolean;
}

/**
 * Reusable deposit input form following Uniswap's component pattern.
 * Uses callbacks instead of internal state for maximum flexibility.
 */
export function DepositInputForm({
  token0Symbol,
  token1Symbol,
  formattedAmounts,
  currencyBalances,
  currencyAmountsUSDValue,
  onUserInput,
  onSetMax,
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
    if (field === "TOKEN0" && onToken0PercentageClick) {
      return onToken0PercentageClick(percentage);
    }
    if (field === "TOKEN1" && onToken1PercentageClick) {
      return onToken1PercentageClick(percentage);
    }
  };

  const handleCalculateDependentAmount = (field: "amount0" | "amount1") => (value: string) => {
    onCalculateDependentAmount?.(value, field);
  };

  return (
    <div className="space-y-4">
      <TokenInputStyles />

      {/* Token 0 Input */}
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

      {/* Plus Icon Divider */}
      {showBothInputs && !hidePlusIcon && (
        <div className="flex justify-center items-center">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
            <PlusIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Token 1 Input */}
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
