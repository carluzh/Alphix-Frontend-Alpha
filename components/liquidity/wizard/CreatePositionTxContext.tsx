'use client';

/**
 * CreatePositionTxContext - Transaction preparation layer for Add Liquidity Wizard
 *
 * Adapted from Uniswap's CreatePositionTxContext pattern.
 * Bridges AddLiquidityContext (UI state) to transaction hooks.
 *
 * Key responsibilities:
 * - Consume wizard state from AddLiquidityContext
 * - Calculate dependent amounts via useAddLiquidityCalculation
 * - Check approvals via useCheckMintApprovals
 * - Provide transaction-ready data to ReviewExecuteModal
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { CurrencyAmount, Currency } from '@uniswap/sdk-core';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useAddLiquidityCalculation, type CalculatedLiquidityData } from '@/lib/liquidity/hooks/transaction/useAddLiquidityCalculation';
import { useCheckMintApprovals, usePrepareMintQuery, useGasFeeEstimate } from '@/lib/liquidity';
import { getToken, getPoolById, TokenSymbol } from '@/lib/pools-config';
import { useTokenUSDPrice } from '@/hooks/useTokenUSDPrice';
import { PositionField } from '@/lib/liquidity/types';
import { useUserSlippageTolerance } from '@/hooks/useSlippage';
import type { Address } from 'viem';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Approval state for a single token
 */
export interface TokenApprovalState {
  needsApproval: boolean;
  isApproving: boolean;
  isApproved: boolean;
}

/**
 * Transaction info structure (simplified from Uniswap's CreatePositionTxAndGasInfo)
 */
export interface CreatePositionTxInfo {
  /** Whether token0 needs approval */
  needsToken0Approval: boolean;
  /** Whether token1 needs approval */
  needsToken1Approval: boolean;
  /** Token0 amount in wei */
  amount0Wei: string;
  /** Token1 amount in wei */
  amount1Wei: string;
  /** Final tick lower (adjusted for tick spacing) */
  tickLower: number;
  /** Final tick upper (adjusted for tick spacing) */
  tickUpper: number;
  /** Calculated liquidity value */
  liquidity: string;
  /** Whether this is a zap transaction */
  isZapMode: boolean;
  /** Input token for zap mode */
  zapInputToken?: 'token0' | 'token1';
}

/**
 * Context value interface - mirrors Uniswap's CreatePositionTxContextType
 */
interface CreatePositionTxContextType {
  /** Transaction info for execution */
  txInfo: CreatePositionTxInfo | undefined;
  /** Calculated data from calculation hook */
  calculatedData: CalculatedLiquidityData | null;
  /** Gas fee estimate in USD */
  gasFeeEstimateUSD: string | undefined;
  /** Transaction/API error */
  transactionError: boolean | string;
  /** Set transaction error */
  setTransactionError: Dispatch<SetStateAction<string | boolean>>;
  /** Dependent amount (calculated from independent input) */
  dependentAmount: string;
  /** Full precision dependent amount */
  dependentAmountFullPrecision: string;
  /** Which field is dependent (calculated) */
  dependentField: 'amount0' | 'amount1' | null;
  /** Whether calculation is in progress */
  isCalculating: boolean;
  /** Approval data from hook */
  approvalData: ReturnType<typeof useCheckMintApprovals>['data'];
  /** Whether approvals are being checked */
  isCheckingApprovals: boolean;
  /** Refetch approvals */
  refetchApprovals: () => void;
  /** Input validation error */
  inputError: ReactNode | undefined;
  /** Formatted amounts for display */
  formattedAmounts: { TOKEN0: string; TOKEN1: string };
  /** USD values for amounts */
  usdValues: { TOKEN0: string; TOKEN1: string };
  /** Current slippage tolerance */
  slippageTolerance: number;
}

const CreatePositionTxContext = createContext<CreatePositionTxContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

export function CreatePositionTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress, chainId } = useAccount();

  // Get wizard state from AddLiquidityContext
  const {
    state,
    depositState,
    poolStateData,
    derivedPositionInfo,
    ticks,
  } = useAddLiquidityContext();

  // Extract state values
  const {
    poolId,
    token0Symbol: stateToken0Symbol,
    token1Symbol: stateToken1Symbol,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    inputSide,
    isZapMode,
  } = state;

  // Get pool config for token symbols
  const poolConfig = poolId ? getPoolById(poolId) : null;
  const token0Symbol = (poolConfig?.currency0.symbol || stateToken0Symbol) as TokenSymbol | undefined;
  const token1Symbol = (poolConfig?.currency1.symbol || stateToken1Symbol) as TokenSymbol | undefined;

  // Get token configs
  const token0Config = token0Symbol ? getToken(token0Symbol) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol) : null;

  // Get USD prices
  const { price: token0USDPrice } = useTokenUSDPrice(token0Symbol || null);
  const { price: token1USDPrice } = useTokenUSDPrice(token1Symbol || null);

  // Get slippage settings
  const { currentSlippage } = useUserSlippageTolerance();
  const slippageToleranceBps = Math.round(currentSlippage * 100);

  // Transaction error state
  const [transactionError, setTransactionError] = useState<string | boolean>(false);

  // ==========================================================================
  // CALCULATION HOOK
  // ==========================================================================

  const {
    calculate: triggerCalculation,
    calculatedData,
    isCalculating,
    error: calculationError,
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
    reset: resetCalculation,
  } = useAddLiquidityCalculation({
    token0Symbol: token0Symbol || 'aUSDC' as TokenSymbol,
    token1Symbol: token1Symbol || 'aUSDT' as TokenSymbol,
    chainId,
  });

  // Trigger calculation when inputs change
  useEffect(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return;

    const tickLowerNum = tickLower !== null ? tickLower : parseInt(String(ticks[0] || '0'));
    const tickUpperNum = tickUpper !== null ? tickUpper : parseInt(String(ticks[1] || '0'));

    // Determine input side
    const activeInputSide = inputSide === 'token0' ? 'amount0' : inputSide === 'token1' ? 'amount1' : null;
    const primaryAmount = activeInputSide === 'amount0' ? amount0 : amount1;

    // Only calculate if we have valid inputs
    if (primaryAmount && parseFloat(primaryAmount) > 0 && !isNaN(tickLowerNum) && !isNaN(tickUpperNum) && tickLowerNum < tickUpperNum) {
      triggerCalculation({
        amount0,
        amount1,
        tickLower: tickLowerNum.toString(),
        tickUpper: tickUpperNum.toString(),
        inputSide: activeInputSide || 'amount0',
        currentPoolTick: poolStateData?.currentPoolTick || null,
        currentPrice: poolStateData?.currentPrice || null,
      });
    }
  }, [
    amount0,
    amount1,
    tickLower,
    tickUpper,
    ticks,
    inputSide,
    token0Symbol,
    token1Symbol,
    chainId,
    poolStateData?.currentPoolTick,
    poolStateData?.currentPrice,
    triggerCalculation,
  ]);

  // Set transaction error from calculation error
  useEffect(() => {
    if (calculationError) {
      setTransactionError(calculationError);
    }
  }, [calculationError]);

  // ==========================================================================
  // APPROVAL HOOK
  // ==========================================================================

  // Prepare approval check params
  const approvalCheckParams = useMemo(() => {
    if (!accountAddress || !chainId || !token0Symbol || !token1Symbol || !calculatedData) {
      return undefined;
    }

    const amount0Wei = calculatedData.amount0 || '0';
    const amount1Wei = calculatedData.amount1 || '0';

    // Don't check if no amounts
    if (BigInt(amount0Wei) <= 0n && BigInt(amount1Wei) <= 0n) {
      return undefined;
    }

    return {
      userAddress: accountAddress,
      token0Symbol,
      token1Symbol,
      amount0: formatUnits(BigInt(amount0Wei), token0Config?.decimals || 18),
      amount1: formatUnits(BigInt(amount1Wei), token1Config?.decimals || 18),
      chainId,
      tickLower: calculatedData.finalTickLower,
      tickUpper: calculatedData.finalTickUpper,
    };
  }, [accountAddress, chainId, token0Symbol, token1Symbol, calculatedData, token0Config, token1Config]);

  const {
    data: approvalData,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useCheckMintApprovals(approvalCheckParams, {
    enabled: !!approvalCheckParams && !isZapMode,
    staleTime: 5000,
  });

  // ==========================================================================
  // TRANSACTION PREPARATION HOOK (Uniswap pattern: useCreateLpPositionCalldataQuery)
  // ==========================================================================

  // Determine input side for prepare query
  const activeInputSide = inputSide === 'token0' ? 'amount0' : inputSide === 'token1' ? 'amount1' : null;
  const primaryAmount = activeInputSide === 'amount0' ? amount0 : amount1;
  const inputTokenForQuery = activeInputSide === 'amount0' ? token0Symbol : token1Symbol;

  // Get tick values - prefer calculated, then state, then ticks array
  const queryTickLower = calculatedData?.finalTickLower ?? tickLower ?? (ticks[0] !== null ? parseInt(String(ticks[0])) : undefined);
  const queryTickUpper = calculatedData?.finalTickUpper ?? tickUpper ?? (ticks[1] !== null ? parseInt(String(ticks[1])) : undefined);

  const { gasLimit: preparedGasLimit } = usePrepareMintQuery(
    {
      userAddress: accountAddress as Address | undefined,
      token0Symbol,
      token1Symbol,
      inputAmount: primaryAmount || undefined,
      inputTokenSymbol: inputTokenForQuery,
      tickLower: queryTickLower,
      tickUpper: queryTickUpper,
      chainId,
      slippageBps: slippageToleranceBps,
    },
    {
      enabled: !!calculatedData && !isZapMode && !transactionError,
      refetchInterval: 10000, // Refresh every 10 seconds
      staleTime: 5000,
    }
  );

  // ==========================================================================
  // GAS FEE ESTIMATION HOOK
  // ==========================================================================

  const { gasFeeFormatted, isLoading: isGasLoading } = useGasFeeEstimate({
    gasLimit: preparedGasLimit,
    chainId,
    skip: !preparedGasLimit,
  });

  // ==========================================================================
  // DERIVED VALUES
  // ==========================================================================

  // Input validation error
  const inputError = useMemo((): ReactNode | undefined => {
    if (!token0Symbol || !token1Symbol) {
      return 'Select tokens';
    }
    if (tickLower === null || tickUpper === null) {
      return 'Select price range';
    }
    if (tickLower >= tickUpper) {
      return 'Invalid price range';
    }
    const amt0 = parseFloat(amount0 || '0');
    const amt1 = parseFloat(amount1 || '0');
    if (amt0 <= 0 && amt1 <= 0) {
      return 'Enter an amount';
    }
    return undefined;
  }, [token0Symbol, token1Symbol, tickLower, tickUpper, amount0, amount1]);

  // Formatted amounts for display
  const formattedAmounts = useMemo(() => {
    return {
      TOKEN0: amount0 || '0',
      TOKEN1: dependentField === 'amount1' && dependentAmount ? dependentAmount : (amount1 || '0'),
    };
  }, [amount0, amount1, dependentAmount, dependentField]);

  // USD values
  const usdValues = useMemo(() => {
    const amt0 = parseFloat(formattedAmounts.TOKEN0 || '0');
    const amt1 = parseFloat(formattedAmounts.TOKEN1 || '0');
    const usd0 = token0USDPrice ? (amt0 * token0USDPrice).toFixed(2) : '0.00';
    const usd1 = token1USDPrice ? (amt1 * token1USDPrice).toFixed(2) : '0.00';
    return { TOKEN0: usd0, TOKEN1: usd1 };
  }, [formattedAmounts, token0USDPrice, token1USDPrice]);

  // Gas fee estimate in USD (from Uniswap-style hooks above)
  const gasFeeEstimateUSD = useMemo(() => {
    return gasFeeFormatted;
  }, [gasFeeFormatted]);

  // Transaction info
  const txInfo = useMemo((): CreatePositionTxInfo | undefined => {
    if (!calculatedData || !token0Symbol || !token1Symbol) {
      return undefined;
    }

    return {
      needsToken0Approval: approvalData?.needsToken0ERC20Approval || false,
      needsToken1Approval: approvalData?.needsToken1ERC20Approval || false,
      amount0Wei: calculatedData.amount0,
      amount1Wei: calculatedData.amount1,
      tickLower: calculatedData.finalTickLower,
      tickUpper: calculatedData.finalTickUpper,
      liquidity: calculatedData.liquidity,
      isZapMode,
      zapInputToken: isZapMode ? (inputSide === 'token0' ? 'token0' : 'token1') : undefined,
    };
  }, [calculatedData, token0Symbol, token1Symbol, approvalData, isZapMode, inputSide]);

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  const value = useMemo(
    (): CreatePositionTxContextType => ({
      txInfo,
      calculatedData,
      gasFeeEstimateUSD,
      transactionError,
      setTransactionError,
      dependentAmount,
      dependentAmountFullPrecision,
      dependentField,
      isCalculating,
      approvalData,
      isCheckingApprovals,
      refetchApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      slippageTolerance: currentSlippage,
    }),
    [
      txInfo,
      calculatedData,
      gasFeeEstimateUSD,
      transactionError,
      dependentAmount,
      dependentAmountFullPrecision,
      dependentField,
      isCalculating,
      approvalData,
      isCheckingApprovals,
      refetchApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      currentSlippage,
    ]
  );

  return (
    <CreatePositionTxContext.Provider value={value}>
      {children}
    </CreatePositionTxContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

export function useCreatePositionTxContext(): CreatePositionTxContextType {
  const context = useContext(CreatePositionTxContext);

  if (!context) {
    throw new Error('`useCreatePositionTxContext` must be used inside of `CreatePositionTxContextProvider`');
  }

  return context;
}
