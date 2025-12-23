/**
 * useDependentAmountFallback - Handle dependent amount calculations with fallbacks
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/hooks/useDependentAmountFallback.ts
 *
 * Simplified for Alphix - uses local SDK calculations instead of Trading API.
 */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { Currency, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';

import { getDependentAmountFromV4Position } from '../../utils/calculations/getDependentAmount';
import { PositionField, type DepositInfo } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface DependentAmountFallbackParams {
  /** The V4 pool */
  pool?: V4Pool;
  /** Lower tick of position */
  tickLower?: number;
  /** Upper tick of position */
  tickUpper?: number;
  /** Which field the user is inputting */
  exactField: PositionField;
  /** The independent (user-entered) amount */
  independentAmount?: CurrencyAmount<Currency>;
  /** Whether SDK calculation failed */
  sdkCalculationFailed?: boolean;
}

export interface UpdatedAmounts {
  updatedFormattedAmounts?: { [field in PositionField]?: string };
  updatedUSDAmounts?: { [field in PositionField]?: CurrencyAmount<Currency> };
  updatedCurrencyAmounts?: { [field in PositionField]?: CurrencyAmount<Currency> | null };
  updatedDeposit0Disabled?: boolean;
  updatedDeposit1Disabled?: boolean;
}

// =============================================================================
// HOOK: useCreatePositionDependentAmountFallback
// =============================================================================

/**
 * Hook to calculate dependent amount for new position creation.
 *
 * Provides a fallback calculation when the primary SDK calculation fails.
 * Uses on-chain simulation or alternative calculation methods.
 *
 * @param pool - V4 pool instance
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @param exactField - Field user is inputting
 * @param independentAmount - User-entered amount
 * @param enabled - Whether to enable calculation
 * @returns Dependent amount as raw string, or undefined
 */
export function useCreatePositionDependentAmountFallback(
  pool: V4Pool | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined,
  exactField: PositionField,
  independentAmount: CurrencyAmount<Currency> | undefined,
  enabled: boolean = true
): string | undefined {
  const [fallbackAmount, setFallbackAmount] = useState<string | undefined>(undefined);

  // Calculate dependent amount using SDK
  useEffect(() => {
    if (!enabled || !pool || tickLower === undefined || tickUpper === undefined || !independentAmount) {
      setFallbackAmount(undefined);
      return;
    }

    try {
      const dependentAmount = getDependentAmountFromV4Position({
        independentAmount,
        pool,
        tickLower,
        tickUpper,
      });

      if (dependentAmount) {
        setFallbackAmount(dependentAmount.quotient.toString());
      } else {
        setFallbackAmount(undefined);
      }
    } catch (error) {
      console.warn('[useDependentAmountFallback] Calculation failed:', error);
      setFallbackAmount(undefined);
    }
  }, [enabled, pool, tickLower, tickUpper, independentAmount, exactField]);

  return fallbackAmount;
}

/**
 * Hook to calculate dependent amount for increasing existing position.
 *
 * Same as create position fallback but for increase liquidity flow.
 */
export function useIncreasePositionDependentAmountFallback(
  pool: V4Pool | undefined,
  tickLower: number | undefined,
  tickUpper: number | undefined,
  exactField: PositionField,
  independentAmount: CurrencyAmount<Currency> | undefined,
  enabled: boolean = true
): string | undefined {
  // For increase liquidity, we use the same calculation
  // The position's existing ticks define the ratio
  return useCreatePositionDependentAmountFallback(
    pool,
    tickLower,
    tickUpper,
    exactField,
    independentAmount,
    enabled
  );
}

// =============================================================================
// HOOK: useUpdatedAmountsFromDependentAmount
// =============================================================================

/**
 * Hook to update deposit info with dependent amount from fallback.
 *
 * Takes a raw dependent amount string and converts it to proper currency amounts,
 * updating all relevant fields in the deposit info.
 *
 * @param token0 - Token 0 currency
 * @param token1 - Token 1 currency
 * @param dependentAmount - Raw dependent amount string
 * @param exactField - Which field user is inputting
 * @param currencyAmounts - Current currency amounts
 * @param currencyAmountsUSDValue - Current USD values
 * @param formattedAmounts - Current formatted amounts
 * @param deposit0Disabled - Whether token0 deposit is disabled
 * @param deposit1Disabled - Whether token1 deposit is disabled
 * @returns Updated amounts object
 */
export function useUpdatedAmountsFromDependentAmount({
  token0,
  token1,
  dependentAmount,
  exactField,
  currencyAmounts,
  currencyAmountsUSDValue,
  formattedAmounts,
  deposit0Disabled,
  deposit1Disabled,
}: {
  token0?: Currency;
  token1?: Currency;
  dependentAmount?: string;
  exactField: PositionField;
  deposit0Disabled?: boolean;
  deposit1Disabled?: boolean;
} & Pick<DepositInfo, 'currencyAmounts' | 'currencyAmountsUSDValue' | 'formattedAmounts'>): UpdatedAmounts {
  // Parse dependent amount for token0 (when user inputs token1)
  const dependentAmount0 = useMemo(() => {
    if (!dependentAmount || exactField !== PositionField.TOKEN1 || !token0) {
      return undefined;
    }
    try {
      return CurrencyAmount.fromRawAmount(token0, dependentAmount);
    } catch {
      return undefined;
    }
  }, [dependentAmount, exactField, token0]);

  // Parse dependent amount for token1 (when user inputs token0)
  const dependentAmount1 = useMemo(() => {
    if (!dependentAmount || exactField !== PositionField.TOKEN0 || !token1) {
      return undefined;
    }
    try {
      return CurrencyAmount.fromRawAmount(token1, dependentAmount);
    } catch {
      return undefined;
    }
  }, [dependentAmount, exactField, token1]);

  return useMemo(() => {
    if (dependentAmount0) {
      return {
        updatedFormattedAmounts: {
          ...formattedAmounts,
          [PositionField.TOKEN0]: dependentAmount0.toExact(),
        },
        updatedUSDAmounts: {
          ...currencyAmountsUSDValue,
          // USD value would be calculated separately by consumer
          [PositionField.TOKEN0]: undefined,
        },
        updatedCurrencyAmounts: {
          ...currencyAmounts,
          [PositionField.TOKEN0]: dependentAmount0,
        },
        updatedDeposit0Disabled: !dependentAmount0.greaterThan(0),
        updatedDeposit1Disabled: deposit1Disabled,
      };
    } else if (dependentAmount1) {
      return {
        updatedFormattedAmounts: {
          ...formattedAmounts,
          [PositionField.TOKEN1]: dependentAmount1.toExact(),
        },
        updatedUSDAmounts: {
          ...currencyAmountsUSDValue,
          // USD value would be calculated separately by consumer
          [PositionField.TOKEN1]: undefined,
        },
        updatedCurrencyAmounts: {
          ...currencyAmounts,
          [PositionField.TOKEN1]: dependentAmount1,
        },
        updatedDeposit0Disabled: deposit0Disabled,
        updatedDeposit1Disabled: !dependentAmount1.greaterThan(0),
      };
    }

    // No dependent amount available, return original values
    return {
      updatedFormattedAmounts: formattedAmounts,
      updatedUSDAmounts: currencyAmountsUSDValue,
      updatedCurrencyAmounts: currencyAmounts,
      updatedDeposit0Disabled: deposit0Disabled,
      updatedDeposit1Disabled: deposit1Disabled,
    };
  }, [
    dependentAmount0,
    dependentAmount1,
    currencyAmounts,
    currencyAmountsUSDValue,
    formattedAmounts,
    deposit0Disabled,
    deposit1Disabled,
  ]);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Merge deposit info with fallback amounts.
 *
 * Helper to combine primary deposit info with fallback-calculated amounts.
 */
export function mergeDepositInfoWithFallback(
  primaryInfo: DepositInfo,
  fallbackAmounts: UpdatedAmounts
): DepositInfo {
  return {
    ...primaryInfo,
    formattedAmounts: fallbackAmounts.updatedFormattedAmounts || primaryInfo.formattedAmounts,
    currencyAmounts: fallbackAmounts.updatedCurrencyAmounts || primaryInfo.currencyAmounts,
    currencyAmountsUSDValue: fallbackAmounts.updatedUSDAmounts || primaryInfo.currencyAmountsUSDValue,
  };
}

/**
 * Check if dependent amount calculation is needed.
 *
 * Returns true if one token amount is set but the other is missing.
 */
export function needsDependentAmountCalculation(
  token0Amount: string | undefined,
  token1Amount: string | undefined,
  deposit0Disabled: boolean,
  deposit1Disabled: boolean
): boolean {
  const hasToken0 = Boolean(token0Amount && parseFloat(token0Amount) > 0);
  const hasToken1 = Boolean(token1Amount && parseFloat(token1Amount) > 0);

  // Need calculation if one is set and the other is empty (and not disabled)
  if (hasToken0 && !hasToken1 && !deposit1Disabled) {
    return true;
  }
  if (hasToken1 && !hasToken0 && !deposit0Disabled) {
    return true;
  }

  return false;
}

/**
 * Get the exact field based on which amount is set.
 */
export function getExactFieldFromAmounts(
  token0Amount: string | undefined,
  token1Amount: string | undefined,
  defaultField: PositionField = PositionField.TOKEN0
): PositionField {
  const hasToken0 = Boolean(token0Amount && parseFloat(token0Amount) > 0);
  const hasToken1 = Boolean(token1Amount && parseFloat(token1Amount) > 0);

  if (hasToken0 && !hasToken1) {
    return PositionField.TOKEN0;
  }
  if (hasToken1 && !hasToken0) {
    return PositionField.TOKEN1;
  }

  return defaultField;
}
