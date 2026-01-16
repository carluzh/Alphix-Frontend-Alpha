/**
 * useDerivedIncreaseInfo Hook
 *
 * Wrapper hook for increase liquidity flows.
 * Mirrors Uniswap's useDerivedIncreaseLiquidityInfo pattern:
 * - Takes an existing position as input
 * - Derives ticks from position
 * - Reuses useAddLiquidityCalculation for amount calculations
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { TokenSymbol, getTokenDefinitions } from '@/lib/pools-config';
import { formatTokenDisplayAmount, getTokenSymbolByAddress } from '@/lib/utils';
import type { ProcessedPosition } from '@/pages/api/liquidity/get-positions';

// =============================================================================
// TYPES
// =============================================================================

export interface UseDerivedIncreaseInfoParams {
  position: ProcessedPosition;
  chainId?: number;
  currentPoolTick?: number | null;
  networkMode?: 'mainnet' | 'testnet';
}

export interface DerivedIncreaseInfo {
  /** Calculated dependent amount for display */
  dependentAmount: string;
  /** Full precision dependent amount (for transaction) */
  dependentAmountFullPrecision: string;
  /** Which field the dependent amount is for */
  dependentField: 'amount0' | 'amount1' | null;
  /** Whether calculation is in progress */
  isCalculating: boolean;
  /** Whether the position is out-of-range */
  isOutOfRange: boolean;
  /** Error message if calculation failed */
  error: string | null;
}

export interface UseDerivedIncreaseInfoResult extends DerivedIncreaseInfo {
  /** Calculate dependent amount for given input */
  calculateDependentAmount: (inputAmount: string, inputSide: 'amount0' | 'amount1') => void;
  /** Reset calculation state */
  reset: () => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for calculating dependent amounts when increasing liquidity on an existing position.
 *
 * Mirrors Uniswap's useDerivedIncreaseLiquidityInfo which wraps useDepositInfo.
 * - Position ticks are fixed (already defined by existing position)
 * - Only calculates dependent amounts based on user input
 */
export function useDerivedIncreaseInfo(
  params: UseDerivedIncreaseInfoParams
): UseDerivedIncreaseInfoResult {
  const { position, chainId, currentPoolTick, networkMode = 'testnet' } = params;

  const [dependentAmount, setDependentAmount] = useState('');
  const [dependentAmountFullPrecision, setDependentAmountFullPrecision] = useState('');
  const [dependentField, setDependentField] = useState<'amount0' | 'amount1' | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calcVersionRef = useRef(0);
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Derive token symbols from position
  const token0Symbol = useMemo(() =>
    getTokenSymbolByAddress(position.token0.address, networkMode) as TokenSymbol,
    [position.token0.address, networkMode]
  );

  const token1Symbol = useMemo(() =>
    getTokenSymbolByAddress(position.token1.address, networkMode) as TokenSymbol,
    [position.token1.address, networkMode]
  );

  // Determine if position is out-of-range
  const isOutOfRange = useMemo(() => {
    if (currentPoolTick === null || currentPoolTick === undefined) return false;
    return currentPoolTick < position.tickLower || currentPoolTick > position.tickUpper;
  }, [currentPoolTick, position.tickLower, position.tickUpper]);

  const calculateDependentAmount = useCallback(async (
    inputAmount: string,
    inputSide: 'amount0' | 'amount1'
  ) => {
    const version = ++calcVersionRef.current;

    // Validate input
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setDependentAmount('');
      setDependentAmountFullPrecision('');
      setDependentField(null);
      return;
    }

    if (!chainId) {
      setError('Chain ID not available');
      return;
    }

    setIsCalculating(true);
    setError(null);
    setDependentField(inputSide === 'amount0' ? 'amount1' : 'amount0');

    try {
      // For out-of-range positions, only one side is needed
      if (isOutOfRange) {
        if (version === calcVersionRef.current) {
          setDependentAmount('0');
          setDependentAmountFullPrecision('0');
          setIsCalculating(false);
        }
        return;
      }

      // Validate token symbols
      if (!token0Symbol || !token1Symbol) {
        // Fallback to ratio-based calculation
        const fallbackAmount = calculateFallbackCorrespondingAmount(inputAmount, inputSide, position);
        if (version === calcVersionRef.current) {
          setDependentAmount(fallbackAmount);
          setDependentAmountFullPrecision(fallbackAmount);
          setIsCalculating(false);
        }
        return;
      }

      // Use liquidity math for precise calculation
      const { calculateLiquidityParameters } = await import('@/lib/liquidity/liquidity-math');
      const result = await calculateLiquidityParameters({
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
        userTickLower: position.tickLower,
        userTickUpper: position.tickUpper,
        chainId,
      });

      if (version === calcVersionRef.current) {
        const dependentTokenSymbol = inputSide === 'amount0' ? token1Symbol : token0Symbol;
        const decimals = tokenDefinitions[dependentTokenSymbol]?.decimals || 18;
        const rawAmount = inputSide === 'amount0' ? result.amount1 : result.amount0;

        const formatted = formatUnits(BigInt(rawAmount || '0'), decimals);
        setDependentAmount(formatTokenDisplayAmount(formatted, dependentTokenSymbol));
        setDependentAmountFullPrecision(formatted);
      }
    } catch (e) {
      // Fallback to ratio-based calculation on error
      const fallbackAmount = calculateFallbackCorrespondingAmount(inputAmount, inputSide, position);
      if (version === calcVersionRef.current) {
        setDependentAmount(fallbackAmount);
        setDependentAmountFullPrecision(fallbackAmount);
        setError(e instanceof Error ? e.message : 'Calculation failed');
      }
    } finally {
      if (version === calcVersionRef.current) {
        setIsCalculating(false);
      }
    }
  }, [chainId, isOutOfRange, position, token0Symbol, token1Symbol, tokenDefinitions]);

  const reset = useCallback(() => {
    calcVersionRef.current++;
    setDependentAmount('');
    setDependentAmountFullPrecision('');
    setDependentField(null);
    setIsCalculating(false);
    setError(null);
  }, []);

  return {
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
    isCalculating,
    isOutOfRange,
    error,
    calculateDependentAmount,
    reset,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fallback ratio-based calculation when SDK calculation fails.
 * Uses the existing position's token ratio.
 */
function calculateFallbackCorrespondingAmount(
  inputAmount: string,
  inputSide: 'amount0' | 'amount1',
  position: ProcessedPosition
): string {
  const posAmount0 = parseFloat(position.token0.amount);
  const posAmount1 = parseFloat(position.token1.amount);
  const input = parseFloat(inputAmount);

  if (!isFinite(input) || input <= 0) return '';

  if (inputSide === 'amount0' && posAmount0 > 0) {
    const ratio = input / posAmount0;
    return (ratio * posAmount1).toFixed(6);
  } else if (inputSide === 'amount1' && posAmount1 > 0) {
    const ratio = input / posAmount1;
    return (ratio * posAmount0).toFixed(6);
  }

  return '0';
}
