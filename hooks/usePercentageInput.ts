import { useCallback } from 'react';
import { formatUnits, parseUnits } from 'viem';

/**
 * Helper function to calculate percentage using bigint arithmetic from a formatted string amount
 * Useful for cases where you don't have the raw bigint value (e.g., position data)
 *
 * @param formattedAmount - The formatted amount as a string (e.g., "123.456")
 * @param percentage - The percentage to calculate (25, 50, 75, or 100)
 * @param decimals - The token's decimals
 * @returns The calculated amount as a string with trailing zeros removed
 */
export function calculatePercentageFromString(
  formattedAmount: string,
  percentage: number,
  decimals: number
): string {
  // For 100%, return the exact amount
  if (percentage === 100) {
    return formattedAmount;
  }

  // Convert string to bigint using the token's decimals
  const amountBigInt = parseUnits(formattedAmount, decimals);

  // Calculate percentage using bigint arithmetic
  const percentageAmount = (amountBigInt * BigInt(percentage)) / 100n;

  // Format back to string - return raw value without any truncation
  return formatUnits(percentageAmount, decimals);
}

/**
 * Custom hook for handling percentage-based input calculations with bigint precision
 *
 * This hook provides a handler function that calculates percentage amounts using
 * bigint arithmetic to avoid floating-point precision errors.
 *
 * @example
 * ```tsx
 * const { data: balanceData } = useBalance({ address, token: token.address });
 * const handlePercentage = usePercentageInput(balanceData, token, setAmount);
 *
 * // In your button:
 * <button onClick={() => handlePercentage(25)}>25%</button>
 * ```
 */
export function usePercentageInput(
  balanceData: { value?: bigint; formatted?: string } | undefined,
  token: { decimals: number; symbol: string },
  setAmount: (value: string) => void
) {
  return useCallback(
    (percentage: number): string | undefined => {
      // Validate balance data exists
      if (!balanceData?.value || !balanceData?.formatted) {
        console.warn(`No valid balance data for ${token.symbol}`);
        return undefined;
      }

      const balanceValue = balanceData.value;

      // Check for zero or negative balance
      if (balanceValue <= 0n) {
        console.warn(`Invalid or zero balance for ${token.symbol}`);
        return undefined;
      }

      let calculatedAmount: string;

      // For 100%, use the exact formatted balance from the blockchain
      if (percentage === 100) {
        calculatedAmount = balanceData.formatted;
      } else {
        // For other percentages, use bigint arithmetic to avoid floating point errors
        // Calculate: (balance * percentage) / 100
        const percentageAmount = (balanceValue * BigInt(percentage)) / 100n;

        // Format the bigint back to a string using the token's decimals
        calculatedAmount = formatUnits(percentageAmount, token.decimals);
      }

      // Use the raw formatted amount without any truncation or abbreviation
      setAmount(calculatedAmount);
      return calculatedAmount;
    },
    [balanceData, token.decimals, token.symbol, setAmount]
  );
}

/**
 * Variant of usePercentageInput that returns both 'from' and 'to' handlers
 * Useful for swap interfaces where you need to handle two different tokens
 *
 * @example
 * ```tsx
 * const { handleFromPercentage, handleToPercentage } = useSwapPercentageInput(
 *   fromTokenBalanceData,
 *   toTokenBalanceData,
 *   fromToken,
 *   toToken,
 *   setFromAmount,
 *   setToAmount
 * );
 * ```
 */
export function useSwapPercentageInput(
  fromBalanceData: { value?: bigint; formatted?: string } | undefined,
  toBalanceData: { value?: bigint; formatted?: string } | undefined,
  fromToken: { decimals: number; symbol: string },
  toToken: { decimals: number; symbol: string },
  setFromAmount: (value: string) => void,
  setToAmount: (value: string) => void
) {
  const handleFromPercentage = usePercentageInput(fromBalanceData, fromToken, setFromAmount);
  const handleToPercentage = usePercentageInput(toBalanceData, toToken, setToAmount);

  return {
    handleFromPercentage,
    handleToPercentage,
  };
}
