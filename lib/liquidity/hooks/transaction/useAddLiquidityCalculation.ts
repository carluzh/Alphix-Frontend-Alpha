/**
 * useAddLiquidityCalculation Hook
 *
 * Extracted calculation logic from AddLiquidityForm.
 * Handles dependent amount calculation with debouncing.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { TokenSymbol, getTokenDefinitions } from '@/lib/pools-config';
import { formatTokenDisplayAmount } from '@/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

export interface CalculatedLiquidityData {
  liquidity: string;
  finalTickLower: number;
  finalTickUpper: number;
  amount0: string;
  amount1: string;
  currentPoolTick?: number;
  currentPrice?: string;
  priceAtTickLower?: string;
  priceAtTickUpper?: string;
}

export interface CalculationInput {
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
  inputSide: 'amount0' | 'amount1';
  currentPoolTick: number | null;
  currentPrice: string | null;
  isShowingTransactionSteps?: boolean;
}

export interface UseAddLiquidityCalculationParams {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  chainId?: number;
}

export interface UseAddLiquidityCalculationResult {
  /** Trigger a calculation */
  calculate: (input: CalculationInput) => void;
  /** Current calculated data */
  calculatedData: CalculatedLiquidityData | null;
  /** Whether calculation is in progress */
  isCalculating: boolean;
  /** Last calculation error */
  error: string | null;
  /** Calculated dependent amount for display */
  dependentAmount: string;
  /** Full precision dependent amount */
  dependentAmountFullPrecision: string;
  /** Which field the dependent amount is for */
  dependentField: 'amount0' | 'amount1' | null;
  /** Reset calculation state */
  reset: () => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for calculating dependent liquidity amounts.
 *
 * Extracts the heavy calculation logic from AddLiquidityForm,
 * providing a cleaner interface for amount calculations.
 */
export function useAddLiquidityCalculation(
  params: UseAddLiquidityCalculationParams
): UseAddLiquidityCalculationResult {
  const { token0Symbol, token1Symbol, chainId } = params;

  const [calculatedData, setCalculatedData] = useState<CalculatedLiquidityData | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dependentAmount, setDependentAmount] = useState('');
  const [dependentAmountFullPrecision, setDependentAmountFullPrecision] = useState('');
  const [dependentField, setDependentField] = useState<'amount0' | 'amount1' | null>(null);

  // Memoize tokenDefinitions to prevent recreating debounced function on every render
  const tokenDefinitions = useMemo(() => getTokenDefinitions(), []);

  // Use ref to persist debounce timeout across renders
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stable calculation function (not recreated on every render)
  const performCalculation = useCallback(async (input: CalculationInput) => {
      const {
        amount0,
        amount1,
        tickLower,
        tickUpper,
        inputSide,
        currentPoolTick,
        currentPrice,
      } = input;

      if (!chainId) {
        setError('Chain ID not available');
        return;
      }

      const tl = parseInt(tickLower);
      const tu = parseInt(tickUpper);

      // Validate tick range
      if (isNaN(tl) || isNaN(tu) || tl >= tu) {
        setCalculatedData(null);
        setDependentAmount('');
        setDependentAmountFullPrecision('');
        setError('Invalid tick range');
        return;
      }

      // Get primary amount
      const primaryAmount = inputSide === 'amount0'
        ? (amount0 || '').replace('...', '').trim()
        : (amount1 || '').replace('...', '').trim();
      const primaryTokenSymbol = inputSide === 'amount0' ? token0Symbol : token1Symbol;

      // Validate primary amount
      if (!primaryAmount || primaryAmount === 'Error' || isNaN(parseFloat(primaryAmount))) {
        setCalculatedData(null);
        setDependentAmount('');
        setDependentAmountFullPrecision('');
        return;
      }

      if (parseFloat(primaryAmount) <= 0) {
        setCalculatedData(null);
        setDependentAmount('');
        setDependentAmountFullPrecision('');
        return;
      }

      setIsCalculating(true);
      setError(null);
      setDependentField(inputSide === 'amount0' ? 'amount1' : 'amount0');

      try {
        // Check if position is out-of-range
        const isOOR =
          currentPoolTick !== null &&
          currentPoolTick !== undefined &&
          (currentPoolTick < tl || currentPoolTick > tu);

        let result: CalculatedLiquidityData;

        if (isOOR) {
          // For out-of-range positions, only one token is needed
          const primaryTokenDef = tokenDefinitions[primaryTokenSymbol];
          const primaryAmountWei = parseUnits(primaryAmount, primaryTokenDef.decimals);

          result = {
            liquidity: '0',
            finalTickLower: tl,
            finalTickUpper: tu,
            amount0: inputSide === 'amount0' ? primaryAmountWei.toString() : '0',
            amount1: inputSide === 'amount1' ? primaryAmountWei.toString() : '0',
            currentPoolTick: currentPoolTick ?? undefined,
            currentPrice: currentPrice || undefined,
          };
        } else {
          // Use liquidity math for in-range positions
          const { calculateLiquidityParameters } = await import('@/lib/liquidity/liquidity-math');
          result = await calculateLiquidityParameters({
            token0Symbol,
            token1Symbol,
            inputAmount: primaryAmount,
            inputTokenSymbol: primaryTokenSymbol,
            userTickLower: tl,
            userTickUpper: tu,
            chainId,
          });
        }

        setCalculatedData(result);

        // Format dependent amount
        const MAX_UINT256 = BigInt(
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        );

        if (inputSide === 'amount0') {
          const token1Decimals = tokenDefinitions[token1Symbol]?.decimals;
          if (token1Decimals !== undefined) {
            const amount1BigInt = BigInt(result.amount1);
            if (amount1BigInt >= MAX_UINT256 / 2n) {
              setDependentAmount('0');
              setDependentAmountFullPrecision('0');
            } else {
              const rawFormatted = formatUnits(amount1BigInt, token1Decimals);
              setDependentAmount(formatTokenDisplayAmount(rawFormatted, token1Symbol));
              setDependentAmountFullPrecision(rawFormatted);
            }
          }
        } else {
          const token0Decimals = tokenDefinitions[token0Symbol]?.decimals;
          if (token0Decimals !== undefined) {
            const amount0BigInt = BigInt(result.amount0);
            if (amount0BigInt >= MAX_UINT256 / 2n) {
              setDependentAmount('0');
              setDependentAmountFullPrecision('0');
            } else {
              const rawFormatted = formatUnits(amount0BigInt, token0Decimals);
              setDependentAmount(formatTokenDisplayAmount(rawFormatted, token0Symbol));
              setDependentAmountFullPrecision(rawFormatted);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Calculation failed');
        setCalculatedData(null);
        setDependentAmount('');
        setDependentAmountFullPrecision('');
      } finally {
        setIsCalculating(false);
      }
  }, [chainId, token0Symbol, token1Symbol, tokenDefinitions]);

  // Debounced wrapper using ref to persist timeout across renders
  const debouncedCalculate = useCallback((input: CalculationInput) => {
    // Clear any existing timeout
    if (debounceTimeoutRef.current !== null) {
      clearTimeout(debounceTimeoutRef.current);
    }
    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      performCalculation(input);
    }, 700);
  }, [performCalculation]);

  const reset = useCallback(() => {
    setCalculatedData(null);
    setIsCalculating(false);
    setError(null);
    setDependentAmount('');
    setDependentAmountFullPrecision('');
    setDependentField(null);
  }, []);

  return {
    calculate: debouncedCalculate,
    calculatedData,
    isCalculating,
    error,
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
    reset,
  };
}
