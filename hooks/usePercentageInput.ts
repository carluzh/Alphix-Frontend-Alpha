import { useCallback } from 'react';
import { formatUnits } from 'viem';

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

      // Truncate to 16 characters max (digits + decimal point)
      if (calculatedAmount.length > 16) {
        calculatedAmount = calculatedAmount.slice(0, 16).replace(/\.$/, '');
      }
      setAmount(calculatedAmount);
      return calculatedAmount;
    },
    [balanceData, token.decimals, token.symbol, setAmount]
  );
}
