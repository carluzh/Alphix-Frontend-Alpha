/**
 * Fee calculation utilities for liquidity positions
 * Standardizes common fee parsing and calculation patterns
 */

import { formatUnits } from "viem";
import { getTokenDefinitions, TokenSymbol, NetworkMode } from "@/lib/pools-config";

/**
 * Parse raw fee amount from contract to display-ready number
 * @param rawAmount - Raw fee amount as hex string (from contract)
 * @param tokenSymbol - Token symbol to get decimals
 * @param networkMode - Network mode for token definitions
 * @returns Parsed fee amount as number
 */
export function parseFeeAmount(
  rawAmount: string | null | undefined,
  tokenSymbol: string,
  networkMode: NetworkMode = "mainnet"
): number {
  if (!rawAmount) return 0;

  const tokenDefinitions = getTokenDefinitions(networkMode);
  const decimals = tokenDefinitions[tokenSymbol as TokenSymbol]?.decimals || 18;

  try {
    return parseFloat(formatUnits(BigInt(rawAmount), decimals));
  } catch {
    return 0;
  }
}

/**
 * Calculate total fees USD value
 */
export function calculateFeesUSD(
  fee0Amount: number,
  fee1Amount: number,
  getUsdPriceForSymbol: (symbol: string) => number,
  token0Symbol: string,
  token1Symbol: string
): number {
  const fee0USD = fee0Amount * getUsdPriceForSymbol(token0Symbol);
  const fee1USD = fee1Amount * getUsdPriceForSymbol(token1Symbol);
  return fee0USD + fee1USD;
}

/**
 * Format fee amount for display
 * @param amount - Fee amount as number
 * @returns Formatted string
 */
export function formatFeeAmount(amount: number): string {
  if (amount === 0) return "0";
  if (amount > 0 && amount < 0.0001) return "< 0.0001";
  if (Math.abs(amount) < 0.000001) return "0";
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0
  });
}

/**
 * Check if fees are effectively zero
 */
export function hasZeroFees(fee0: number, fee1: number): boolean {
  return fee0 <= 0 && fee1 <= 0;
}

/**
 * Parse both fee amounts at once
 */
export function parseFeeAmounts(
  raw0: string | null | undefined,
  raw1: string | null | undefined,
  token0Symbol: string,
  token1Symbol: string,
  networkMode: NetworkMode = "mainnet"
): { fee0: number; fee1: number } {
  return {
    fee0: parseFeeAmount(raw0, token0Symbol, networkMode),
    fee1: parseFeeAmount(raw1, token1Symbol, networkMode),
  };
}

/**
 * Calculate fee percentage distribution
 */
export function calculateFeeDistribution(
  fee0USD: number,
  fee1USD: number
): { fee0Percent: number; fee1Percent: number } | null {
  const total = fee0USD + fee1USD;
  if (total === 0) return null;

  return {
    fee0Percent: (fee0USD / total) * 100,
    fee1Percent: (fee1USD / total) * 100,
  };
}
