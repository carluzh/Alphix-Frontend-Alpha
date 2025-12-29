/**
 * Shared utilities for liquidity form components (Add & Remove)
 * Consolidates common logic to reduce duplication and improve maintainability
 */

import React from "react";
import { formatUSD } from "@/lib/format";
import { getToken, TokenSymbol } from "@/lib/pools-config";

/**
 * Get token icon URL from symbol
 */
export const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

/**
 * Format token display amount with proper precision
 * Shows "< 0.000001" for very small amounts
 */
export const formatTokenDisplayAmount = (amount: string, symbol?: TokenSymbol) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0";
  if (num > 0 && num < 0.000001) return "< 0.000001";
  return num.toFixed(6);
};

/**
 * Format calculated USD amounts with max 9 decimals and ellipsis for overflow
 * Used for displaying USD values below input fields
 */
export const formatCalculatedAmount = (value: number): React.ReactNode => {
  if (!Number.isFinite(value) || value <= 0) return formatUSD(0);

  const formatted = formatUSD(value);

  const match = formatted.match(/\$([0-9,]+\.?[0-9]*)/);
  if (!match) return formatted;

  const [, numericPart] = match;
  const [integerPart, decimalPart] = numericPart.split('.');

  if (!decimalPart || decimalPart.length <= 9) {
    return formatted;
  }

  const truncatedDecimal = decimalPart.substring(0, 9);
  const truncatedFormatted = `$${integerPart}.${truncatedDecimal}`;

  return (
    <span>
      {truncatedFormatted}
      <span className="text-muted-foreground">...</span>
    </span>
  );
};

/**
 * Get USD price for a token symbol from price data
 */
export const getUSDPriceForSymbol = (symbol: string | undefined, allPrices: any): number => {
  if (!symbol) return 0;
  const s = symbol.toUpperCase();
  if (s.includes('BTC')) return allPrices?.BTC?.usd ?? 0;
  if (s.includes('ETH')) return allPrices?.ETH?.usd ?? 0;
  if (s.includes('USDC')) return allPrices?.USDC?.usd ?? 1;
  if (s.includes('USDT')) return allPrices?.USDT?.usd ?? 1;
  return 0;
};

/**
 * Calculate the corresponding amount for the other token based on position ratio
 * Used in both Add and Remove liquidity forms
 */
export const calculateCorrespondingAmount = (
  inputAmount: string,
  inputSide: 'amount0' | 'amount1',
  position: { token0: { amount: string }, token1: { amount: string }, isInRange?: boolean }
): string => {
  if (!inputAmount || parseFloat(inputAmount) <= 0) return "";

  // For out-of-range positions, don't calculate corresponding amount
  if (position.isInRange === false) return "0";

  const posAmount0 = parseFloat(position.token0.amount);
  const posAmount1 = parseFloat(position.token1.amount);
  const input = parseFloat(inputAmount);

  if (inputSide === 'amount0' && posAmount0 > 0) {
    const ratio = input / posAmount0;
    const amount1 = ratio * posAmount1;
    return amount1.toFixed(6);
  } else if (inputSide === 'amount1' && posAmount1 > 0) {
    const ratio = input / posAmount1;
    const amount0 = ratio * posAmount0;
    return amount0.toFixed(6);
  }

  return "";
};

/**
 * Check if amounts are valid for transaction
 */
export const areAmountsValid = (amount0: string, amount1: string): boolean => {
  const amt0 = parseFloat(amount0 || "0");
  const amt1 = parseFloat(amount1 || "0");
  return amt0 > 0 || amt1 > 0;
};

/**
 * Format percentage button label (25%, 50%, 75%, MAX)
 */
export const getPercentageLabel = (percentage: number): string => {
  return percentage === 100 ? 'MAX' : `${percentage}%`;
};

/**
 * Standard percentage options for buttons
 */
export const PERCENTAGE_OPTIONS = [25, 50, 75, 100] as const;

/**
 * Permit2 address constant
 */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * Max uint256 value for approvals
 */
export const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935" as const;
