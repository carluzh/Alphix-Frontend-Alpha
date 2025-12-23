/**
 * useDepositInfo - Derive deposit information from user inputs
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/Create/hooks/useDepositInfo.tsx
 *
 * Simplified for Alphix (V4 only).
 */

import { useMemo } from 'react';
import { Currency, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import { useAccount, useBalance } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';

import { getDependentAmountFromV4Position } from '../../utils/calculations/getDependentAmount';
import { PositionField, type DepositInfo } from '../../types';

// =============================================================================
// HELPER: Try parse currency amount
// =============================================================================

/**
 * Safely parse a currency amount from a string.
 * Returns undefined if parsing fails.
 */
function tryParseCurrencyAmount(
  value: string | undefined,
  currency: Currency | undefined
): CurrencyAmount<Currency> | undefined {
  if (!value || !currency || value === '') {
    return undefined;
  }

  try {
    const trimmedValue = value.trim();
    if (trimmedValue === '' || trimmedValue === '.') {
      return undefined;
    }

    // Handle scientific notation
    const numericValue = parseFloat(trimmedValue);
    if (isNaN(numericValue) || !isFinite(numericValue) || numericValue < 0) {
      return undefined;
    }

    // Parse using viem
    const parsedAmount = parseUnits(
      numericValue.toFixed(currency.decimals),
      currency.decimals
    );

    return CurrencyAmount.fromRawAmount(currency, parsedAmount.toString());
  } catch {
    return undefined;
  }
}

// =============================================================================
// HOOK: useTokenBalance
// =============================================================================

interface UseTokenBalanceResult {
  balance: CurrencyAmount<Currency> | undefined;
  isLoading: boolean;
}

/**
 * Hook to get token balance for a currency.
 */
function useTokenBalance(
  currency: Currency | undefined,
  address: `0x${string}` | undefined
): UseTokenBalanceResult {
  const tokenAddress = currency?.isNative
    ? undefined
    : (currency?.wrapped?.address as `0x${string}` | undefined);

  const { data: balanceData, isLoading } = useBalance({
    address,
    token: tokenAddress,
    query: {
      enabled: !!address && !!currency,
    },
  });

  const balance = useMemo(() => {
    if (!balanceData || !currency) return undefined;

    try {
      return CurrencyAmount.fromRawAmount(currency, balanceData.value.toString());
    } catch {
      return undefined;
    }
  }, [balanceData, currency]);

  return { balance, isLoading };
}

// =============================================================================
// HOOK: useDepositInfo
// =============================================================================

export interface UseDepositInfoParams {
  /** V4 pool instance */
  pool?: V4Pool;
  /** User wallet address */
  address?: `0x${string}`;
  /** Token 0 currency */
  token0?: Currency;
  /** Token 1 currency */
  token1?: Currency;
  /** Lower tick of position */
  tickLower?: number;
  /** Upper tick of position */
  tickUpper?: number;
  /** Which field the user is editing */
  exactField: PositionField;
  /** User-entered amounts */
  exactAmounts: {
    [PositionField.TOKEN0]?: string;
    [PositionField.TOKEN1]?: string;
  };
  /** Skip dependent amount calculation (for out-of-range positions) */
  skipDependentAmount?: boolean;
}

/**
 * useDepositInfo - Calculate deposit information including dependent amounts.
 *
 * This hook:
 * 1. Parses user input amounts
 * 2. Calculates dependent token amount based on position range
 * 3. Fetches token balances
 * 4. Validates for insufficient balance
 *
 * @param params - Deposit parameters
 * @returns DepositInfo with amounts, balances, and errors
 */
export function useDepositInfo(params: UseDepositInfoParams): DepositInfo {
  const {
    pool,
    address,
    token0,
    token1,
    tickLower,
    tickUpper,
    exactField,
    exactAmounts,
    skipDependentAmount,
  } = params;

  // Fetch token balances
  const { balance: token0Balance } = useTokenBalance(token0, address);
  const { balance: token1Balance } = useTokenBalance(token1, address);

  // Determine independent and dependent tokens
  const [independentToken, dependentToken] =
    exactField === PositionField.TOKEN0 ? [token0, token1] : [token1, token0];

  // Parse independent amount
  const independentAmount = useMemo(() => {
    return tryParseCurrencyAmount(exactAmounts[exactField], independentToken);
  }, [exactAmounts, exactField, independentToken]);

  // Parse other amount (for fallback)
  const otherAmount = useMemo(() => {
    const otherField = exactField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0;
    return tryParseCurrencyAmount(exactAmounts[otherField], dependentToken);
  }, [exactAmounts, exactField, dependentToken]);

  // Calculate dependent amount
  const dependentAmount = useMemo((): CurrencyAmount<Currency> | undefined | null => {
    // Skip calculation if requested
    if (skipDependentAmount) {
      return dependentToken ? CurrencyAmount.fromRawAmount(dependentToken, '0') : undefined;
    }

    // Need all required inputs
    if (
      tickLower === undefined ||
      tickUpper === undefined ||
      !pool ||
      !independentAmount ||
      !dependentToken
    ) {
      return undefined;
    }

    // Validate tick range
    if (tickLower >= tickUpper) {
      return undefined;
    }

    try {
      const dependentTokenAmount = getDependentAmountFromV4Position({
        independentAmount,
        pool,
        tickLower,
        tickUpper,
      });

      return CurrencyAmount.fromRawAmount(dependentToken, dependentTokenAmount.quotient);
    } catch (error) {
      console.warn('[useDepositInfo] Dependent amount calculation failed:', error);
      // Fall back to other amount if calculation fails
      return otherAmount;
    }
  }, [
    skipDependentAmount,
    tickLower,
    tickUpper,
    pool,
    independentAmount,
    dependentToken,
    otherAmount,
  ]);

  // Build parsed amounts
  const dependentField = exactField === PositionField.TOKEN0 ? PositionField.TOKEN1 : PositionField.TOKEN0;

  const parsedAmounts = useMemo((): {
    [PositionField.TOKEN0]: CurrencyAmount<Currency> | undefined | null;
    [PositionField.TOKEN1]: CurrencyAmount<Currency> | undefined | null;
  } => {
    return {
      [PositionField.TOKEN0]: exactField === PositionField.TOKEN0 ? independentAmount : dependentAmount,
      [PositionField.TOKEN1]: exactField === PositionField.TOKEN0 ? dependentAmount : independentAmount,
    };
  }, [dependentAmount, independentAmount, exactField]);

  const { TOKEN0: currency0Amount, TOKEN1: currency1Amount } = parsedAmounts;

  // Validate balances and generate error
  const error = useMemo((): string | undefined => {
    if (!parsedAmounts[PositionField.TOKEN0] || !parsedAmounts[PositionField.TOKEN1]) {
      return 'Enter an amount';
    }

    const insufficientToken0 =
      currency0Amount && token0Balance && token0Balance.lessThan(currency0Amount);
    const insufficientToken1 =
      currency1Amount && token1Balance && token1Balance.lessThan(currency1Amount);

    if (insufficientToken0 && insufficientToken1) {
      return 'Insufficient balance';
    }

    if (insufficientToken0) {
      return `Insufficient ${token0?.symbol} balance`;
    }

    if (insufficientToken1) {
      return `Insufficient ${token1?.symbol} balance`;
    }

    return undefined;
  }, [parsedAmounts, currency0Amount, currency1Amount, token0Balance, token1Balance, token0, token1]);

  // Build formatted amounts
  const formattedAmounts = useMemo((): {
    [PositionField.TOKEN0]?: string;
    [PositionField.TOKEN1]?: string;
  } => {
    return {
      [exactField]: exactAmounts[exactField],
      [dependentField]: dependentAmount?.toExact(),
    };
  }, [exactField, exactAmounts, dependentField, dependentAmount]);

  // Build currency amounts
  const currencyAmounts = useMemo((): {
    [PositionField.TOKEN0]?: CurrencyAmount<Currency> | null;
    [PositionField.TOKEN1]?: CurrencyAmount<Currency> | null;
  } => {
    return {
      [exactField]: independentAmount,
      [dependentField]: dependentAmount,
    };
  }, [exactField, independentAmount, dependentField, dependentAmount]);

  return useMemo(
    () => ({
      currencyBalances: {
        [PositionField.TOKEN0]: token0Balance,
        [PositionField.TOKEN1]: token1Balance,
      },
      formattedAmounts,
      currencyAmounts,
      currencyAmountsUSDValue: {
        // USD values would require price oracle integration
        // Kept as undefined for now - can be added later
        [PositionField.TOKEN0]: undefined,
        [PositionField.TOKEN1]: undefined,
      },
      error,
    }),
    [token0Balance, token1Balance, formattedAmounts, currencyAmounts, error]
  );
}

// =============================================================================
// HELPER: Check if amounts exceed balance
// =============================================================================

export interface BalanceCheckResult {
  insufficientToken0: boolean;
  insufficientToken1: boolean;
  hasInsufficientBalance: boolean;
}

/**
 * Check if deposit amounts exceed available balances.
 */
export function checkBalanceInsufficiency(
  depositInfo: DepositInfo
): BalanceCheckResult {
  const { currencyBalances, currencyAmounts } = depositInfo;

  const amount0 = currencyAmounts[PositionField.TOKEN0];
  const amount1 = currencyAmounts[PositionField.TOKEN1];
  const balance0 = currencyBalances[PositionField.TOKEN0];
  const balance1 = currencyBalances[PositionField.TOKEN1];

  const insufficientToken0 = !!(amount0 && balance0 && balance0.lessThan(amount0));
  const insufficientToken1 = !!(amount1 && balance1 && balance1.lessThan(amount1));

  return {
    insufficientToken0,
    insufficientToken1,
    hasInsufficientBalance: insufficientToken0 || insufficientToken1,
  };
}

// =============================================================================
// HELPER: Get max spendable amount
// =============================================================================

/**
 * Get the maximum spendable amount for a currency.
 * For native tokens, reserves some for gas.
 */
export function getMaxSpendableAmount(
  balance: CurrencyAmount<Currency> | undefined,
  isNativeToken: boolean,
  gasBuffer: string = '0.01' // Reserve 0.01 native token for gas
): CurrencyAmount<Currency> | undefined {
  if (!balance) return undefined;

  if (isNativeToken) {
    try {
      const bufferAmount = CurrencyAmount.fromRawAmount(
        balance.currency,
        parseUnits(gasBuffer, balance.currency.decimals).toString()
      );

      if (balance.greaterThan(bufferAmount)) {
        return balance.subtract(bufferAmount);
      }

      return CurrencyAmount.fromRawAmount(balance.currency, '0');
    } catch {
      return balance;
    }
  }

  return balance;
}
