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
import { usePrepareMintQuery, useGasFeeEstimate } from '@/lib/liquidity';
import { getToken, getPoolById, TokenSymbol } from '@/lib/pools-config';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { PositionField } from '@/lib/liquidity/types';
import { useUserSlippageTolerance } from '@/hooks/useSlippage';
import type { Address } from 'viem';
import { useNetwork } from '@/lib/network-context';

// Unified Yield imports for 'rehypo' mode
import { useCheckMintApprovalsWithMode } from '@/lib/liquidity/hooks/approval/useModeAwareApprovals';
import { previewDeposit } from '@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx';
import type { DepositPreviewResult } from '@/lib/liquidity/unified-yield/types';
import { usePublicClient } from 'wagmi';
import * as Sentry from '@sentry/nextjs';

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
  /** Shares to mint (Unified Yield only) */
  sharesToMint?: bigint;
  /** Whether this is a Unified Yield position */
  isUnifiedYield?: boolean;
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
  approvalData: ReturnType<typeof useCheckMintApprovalsWithMode>['data'];
  /** Whether approvals are being checked */
  isCheckingApprovals: boolean;
  /** Refetch approvals and return fresh data */
  refetchApprovals: ReturnType<typeof useCheckMintApprovalsWithMode>['refetch'];
  /** Input validation error */
  inputError: ReactNode | undefined;
  /** Formatted amounts for display */
  formattedAmounts: { TOKEN0: string; TOKEN1: string };
  /** USD values for amounts */
  usdValues: { TOKEN0: string; TOKEN1: string };
  /** Current slippage tolerance */
  slippageTolerance: number;
  /** Unified Yield deposit preview (when mode is 'rehypo') */
  depositPreview: DepositPreviewResult | null;
  /** Whether this is Unified Yield mode */
  isUnifiedYield: boolean;
}

const CreatePositionTxContext = createContext<CreatePositionTxContextType | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

export function CreatePositionTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { networkMode } = useNetwork();

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
    mode,
    depositMode, // zap or balanced
  } = state;

  // Determine if this is Unified Yield mode
  const isUnifiedYield = mode === 'rehypo';

  // State for Unified Yield deposit preview
  const [depositPreview, setDepositPreview] = useState<DepositPreviewResult | null>(null);
  const [isUnifiedYieldCalculating, setIsUnifiedYieldCalculating] = useState(false);

  // Get pool config for token symbols
  const poolConfig = poolId ? getPoolById(poolId, networkMode) : null;
  const token0Symbol = (poolConfig?.currency0.symbol || stateToken0Symbol) as TokenSymbol | undefined;
  const token1Symbol = (poolConfig?.currency1.symbol || stateToken1Symbol) as TokenSymbol | undefined;

  // Get token configs
  const token0Config = token0Symbol ? getToken(token0Symbol, networkMode) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol, networkMode) : null;

  // Get hook address for Unified Yield
  const hookAddress = poolConfig?.hooks as Address | undefined;

  // Get USD prices
  const createPriceSymbols = useMemo(
    () => [token0Symbol, token1Symbol].filter(Boolean) as string[],
    [token0Symbol, token1Symbol]
  );
  const { prices: createPrices } = useTokenPrices(createPriceSymbols);
  const token0USDPrice = token0Symbol ? (createPrices[token0Symbol] || null) : null;
  const token1USDPrice = token1Symbol ? (createPrices[token1Symbol] || null) : null;

  // Get slippage settings
  const { currentSlippage, updateAutoSlippage } = useUserSlippageTolerance();
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
    token0Symbol: token0Symbol || 'atUSDC' as TokenSymbol,
    token1Symbol: token1Symbol || 'atDAI' as TokenSymbol,
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
  // UNIFIED YIELD PREVIEW (for 'rehypo' mode)
  // ==========================================================================

  // Calculate Unified Yield deposit preview when in 'rehypo' mode AND balanced deposit mode
  // IMPORTANT: Skip when in 'zap' mode - the zap preview hook handles that differently
  useEffect(() => {
    if (!isUnifiedYield || !hookAddress || !publicClient) {
      setDepositPreview(null);
      return;
    }

    // In zap mode, the zap preview hook handles calculations - don't use balanced depositPreview
    if (depositMode === 'zap') {
      setDepositPreview(null);
      return;
    }

    // Determine which input the user is entering - MUST be explicitly set
    const activeInputSide = inputSide === 'token0' ? 'token0' : inputSide === 'token1' ? 'token1' : null;

    // Only calculate if we have a valid inputSide
    if (!activeInputSide) {
      setDepositPreview(null);
      return;
    }

    // Use ONLY the user's input amount (the side they're typing in)
    const inputAmount = activeInputSide === 'token0' ? amount0 : amount1;
    const inputDecimals = activeInputSide === 'token0'
      ? (token0Config?.decimals ?? 18)
      : (token1Config?.decimals ?? 18);

    // Only calculate if we have valid input
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setDepositPreview(null);
      return;
    }

    // Convert input amount to wei
    const inputWei = parseUnits(inputAmount, inputDecimals);

    // Skip recalculation if we already have a valid preview with the same input
    // This prevents recalculating when the dependent amount is synced to context
    if (depositPreview && depositPreview.inputSide === activeInputSide) {
      const existingInputAmount = activeInputSide === 'token0'
        ? depositPreview.amount0
        : depositPreview.amount1;
      if (existingInputAmount === inputWei) {
        // Preview is still valid for the same input, no need to recalculate
        return;
      }
    }

    let cancelled = false;
    setIsUnifiedYieldCalculating(true);

    previewDeposit(
      hookAddress,
      inputWei,
      activeInputSide,
      token0Config?.decimals ?? 18,
      token1Config?.decimals ?? 18,
      18, // Share decimals (standard)
      publicClient
    )
      .then((preview) => {
        if (!cancelled && preview) {
          setDepositPreview(preview);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Unified Yield preview failed:', err);
          setDepositPreview(null);

          // Capture to Sentry for debugging preview failures
          Sentry.captureException(err, {
            tags: {
              component: 'UnifiedYieldPreview',
              inputSide: activeInputSide || 'unknown',
            },
            extra: {
              hookAddress,
              inputAmount: inputWei.toString(),
              inputSide: activeInputSide,
              token0Decimals: token0Config?.decimals,
              token1Decimals: token1Config?.decimals,
              cause: err?.cause?.message || err?.cause,
              shortMessage: err?.shortMessage,
            },
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsUnifiedYieldCalculating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    isUnifiedYield,
    depositMode,
    hookAddress,
    publicClient,
    inputSide,
    amount0,
    amount1,
    token0Config?.decimals,
    token1Config?.decimals,
    depositPreview,
  ]);

  // ==========================================================================
  // APPROVAL HOOK (single mode-aware hook for both V4 and UY)
  // ==========================================================================

  // Build unified approval params - works for both modes
  const approvalCheckParams = useMemo(() => {
    if (!accountAddress || !chainId || !poolId || !token0Symbol || !token1Symbol) {
      return undefined;
    }

    // Get amounts based on mode
    const amount0Wei = isUnifiedYield
      ? (depositPreview?.amount0 ?? 0n)
      : BigInt(calculatedData?.amount0 || '0');
    const amount1Wei = isUnifiedYield
      ? (depositPreview?.amount1 ?? 0n)
      : BigInt(calculatedData?.amount1 || '0');

    // Don't check if no amounts
    if (amount0Wei <= 0n && amount1Wei <= 0n) return undefined;

    return {
      mode: (isUnifiedYield ? 'rehypo' : 'concentrated') as 'rehypo' | 'concentrated',
      userAddress: accountAddress,
      poolId,
      token0Symbol,
      token1Symbol,
      token0Address: poolConfig?.currency0.address as Address | undefined,
      token1Address: poolConfig?.currency1.address as Address | undefined,
      amount0: isUnifiedYield
        ? (depositPreview?.amount0Formatted || '0')
        : formatUnits(amount0Wei, token0Config?.decimals || 18),
      amount1: isUnifiedYield
        ? (depositPreview?.amount1Formatted || '0')
        : formatUnits(amount1Wei, token1Config?.decimals || 18),
      amount0Wei,
      amount1Wei,
      chainId,
    };
  }, [
    accountAddress,
    chainId,
    poolId,
    token0Symbol,
    token1Symbol,
    poolConfig,
    token0Config,
    token1Config,
    isUnifiedYield,
    depositPreview,
    calculatedData,
  ]);

  // Single mode-aware approval hook for both V4 and UY
  const {
    data: modeAwareApprovalData,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useCheckMintApprovalsWithMode(approvalCheckParams, {
    enabled: !!approvalCheckParams,
    staleTime: 5000,
  });

  // Unified approval data format
  const approvalData = useMemo(() => ({
    needsToken0ERC20Approval: modeAwareApprovalData?.needsToken0ERC20Approval ?? false,
    needsToken1ERC20Approval: modeAwareApprovalData?.needsToken1ERC20Approval ?? false,
    needsPermit2Signature: modeAwareApprovalData?.needsPermit2Signature ?? false,
    needsAnyApproval: modeAwareApprovalData?.needsAnyApproval ?? false,
    isUnifiedYield,
    approvalTarget: modeAwareApprovalData?.approvalTarget ?? null,
  }), [modeAwareApprovalData, isUnifiedYield]);

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
      enabled: !!calculatedData && !transactionError && !isCalculating,
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
    // For Unified Yield, use preview amounts
    if (isUnifiedYield && depositPreview) {
      return {
        TOKEN0: depositPreview.amount0Formatted || '0',
        TOKEN1: depositPreview.amount1Formatted || '0',
      };
    }
    // For V4 Standard, use calculated amounts
    return {
      TOKEN0: amount0 || '0',
      TOKEN1: dependentField === 'amount1' && dependentAmount ? dependentAmount : (amount1 || '0'),
    };
  }, [isUnifiedYield, depositPreview, amount0, amount1, dependentAmount, dependentField]);

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
    if (!token0Symbol || !token1Symbol) {
      return undefined;
    }

    // Unified Yield mode
    if (isUnifiedYield) {
      if (!depositPreview || depositPreview.shares <= 0n) {
        return undefined;
      }
      return {
        needsToken0Approval: approvalData?.needsToken0ERC20Approval || false,
        needsToken1Approval: approvalData?.needsToken1ERC20Approval || false,
        amount0Wei: depositPreview.amount0.toString(),
        amount1Wei: depositPreview.amount1.toString(),
        tickLower: 0, // Not applicable for Unified Yield (full range managed by hook)
        tickUpper: 0,
        liquidity: '0', // Not applicable - Unified Yield uses shares
        sharesToMint: depositPreview.shares,
        isUnifiedYield: true,
      };
    }

    // V4 Standard mode
    if (!calculatedData) {
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
      isUnifiedYield: false,
    };
  }, [isUnifiedYield, calculatedData, depositPreview, token0Symbol, token1Symbol, approvalData]);

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  // Unified dependent amount - use deposit preview for Unified Yield
  const effectiveDependentAmount = useMemo(() => {
    if (isUnifiedYield && depositPreview) {
      // Return the "other" amount based on input side
      return depositPreview.inputSide === 'token0'
        ? depositPreview.amount1Formatted
        : depositPreview.amount0Formatted;
    }
    return dependentAmount;
  }, [isUnifiedYield, depositPreview, dependentAmount]);

  const effectiveDependentField = useMemo(() => {
    if (isUnifiedYield && depositPreview) {
      return depositPreview.inputSide === 'token0' ? 'amount1' : 'amount0';
    }
    return dependentField;
  }, [isUnifiedYield, depositPreview, dependentField]);

  const effectiveIsCalculating = isUnifiedYield ? isUnifiedYieldCalculating : isCalculating;

  const value = useMemo(
    (): CreatePositionTxContextType => ({
      txInfo,
      calculatedData,
      gasFeeEstimateUSD,
      transactionError,
      setTransactionError,
      dependentAmount: effectiveDependentAmount,
      dependentAmountFullPrecision: isUnifiedYield ? effectiveDependentAmount : dependentAmountFullPrecision,
      dependentField: effectiveDependentField,
      isCalculating: effectiveIsCalculating,
      approvalData,
      isCheckingApprovals,
      refetchApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      slippageTolerance: currentSlippage,
      depositPreview,
      isUnifiedYield,
    }),
    [
      txInfo,
      calculatedData,
      gasFeeEstimateUSD,
      transactionError,
      effectiveDependentAmount,
      dependentAmountFullPrecision,
      effectiveDependentField,
      effectiveIsCalculating,
      isUnifiedYield,
      approvalData,
      isCheckingApprovals,
      refetchApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      currentSlippage,
      depositPreview,
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
