import { formatUnits } from 'viem';

/**
 * Calculates a percentage of a token balance using bigint arithmetic to avoid floating point errors
 *
 * @param balanceValue - The raw balance value as bigint (from useBalance().value)
 * @param formattedBalance - The formatted balance string (from useBalance().formatted)
 * @param percentage - The percentage to calculate (25, 50, 75, or 100)
 * @param tokenDecimals - The token's decimals (e.g., 6 for USDC, 18 for ETH)
 * @returns The calculated amount as a string, with trailing zeros removed
 */
export function calculatePercentageAmount(
  balanceValue: bigint,
  formattedBalance: string,
  percentage: number,
  tokenDecimals: number
): string {
  // For 100%, always use the exact blockchain value
  if (percentage === 100) {
    return formattedBalance;
  }

  // For other percentages, use bigint arithmetic to avoid floating point errors
  // Calculate: (balance * percentage) / 100
  const percentageAmount = (balanceValue * BigInt(percentage)) / 100n;

  // Format the bigint back to a string using the token's decimals
  const formattedAmount = formatUnits(percentageAmount, tokenDecimals);

  // Just remove trailing zeros from the full precision
  return formattedAmount.replace(/\.?0+$/, '');
}
