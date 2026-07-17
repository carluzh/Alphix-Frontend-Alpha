'use client';

import {
  createContext,
  useCallback,
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
import { formatUnits } from 'viem';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useAddLiquidityCalculation, type CalculatedLiquidityData } from '@/lib/liquidity/hooks/transaction/useAddLiquidityCalculation';
import { usePrepareMintQuery, useGasFeeEstimate } from '@/lib/liquidity';
import { getToken, getPoolBySlug, TokenSymbol } from '@/lib/pools-config';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { useUserSlippageTolerance } from '@/hooks/useSlippage';
import type { Address } from 'viem';
import { chainIdForMode } from '@/lib/network-mode';
import { formatTokenDisplayAmount } from '@/lib/utils';

import { useUnifiedYieldApprovals } from '@/lib/liquidity/unified-yield/useUnifiedYieldApprovals';
import type { DepositPreviewResult, UnifiedYieldApprovalStatus } from '@/lib/liquidity/unified-yield/types';
import { createNetworkClient } from '@/lib/viemClient';
import { useUnifiedYieldDepositPreview } from './hooks/useUnifiedYieldDepositPreview';

export interface CreatePositionTxInfo {
  needsToken0Approval: boolean;
  needsToken1Approval: boolean;
  amount0Wei: string;
  amount1Wei: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  sharesToMint?: bigint;
  isUnifiedYield?: boolean;
}

interface CreatePositionTxContextType {
  txInfo: CreatePositionTxInfo | undefined;
  calculatedData: CalculatedLiquidityData | null;
  gasFeeEstimateUSD: string | undefined;
  transactionError: boolean | string;
  setTransactionError: Dispatch<SetStateAction<string | boolean>>;
  dependentAmount: string;
  dependentAmountFullPrecision: string;
  dependentField: 'amount0' | 'amount1' | null;
  isCalculating: boolean;
  // UY-only: V4 flows trust the prepare-tx API (`apiResponse.needsApproval` and
  // friends) and have no FE-side allowance polling. `unifiedYieldApprovalStatus`
  // is null in V4 mode; `refetchUnifiedYieldApprovals` is a no-op in V4 mode.
  unifiedYieldApprovalStatus: UnifiedYieldApprovalStatus | null;
  refetchUnifiedYieldApprovals: (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }) => Promise<UnifiedYieldApprovalStatus | null>;
  inputError: ReactNode | undefined;
  formattedAmounts: { TOKEN0: string; TOKEN1: string };
  usdValues: { TOKEN0: string; TOKEN1: string };
  slippageTolerance: number;
  depositPreview: DepositPreviewResult | null;
  isUnifiedYield: boolean;
  /** Display amounts overwritten from /lp/create.details after Confirm; the
   *  Review reads from these so the panel matches the wallet popup. */
  syncedAmounts: { TOKEN0: string; TOKEN1: string } | null;
  syncAmountsFromApi: (
    raw: { TOKEN0: string; TOKEN1: string },
    decimals: { decimals0: number; decimals1: number },
  ) => void;
  clearSyncedAmounts: () => void;
}

const CreatePositionTxContext = createContext<CreatePositionTxContextType | undefined>(undefined);

export function CreatePositionTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();

  const {
    state,
    poolStateData,
    ticks,
    poolNetworkMode,
  } = useAddLiquidityContext();

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
  } = state;

  const effectiveNetworkMode = poolNetworkMode ?? 'base';
  const chainId = chainIdForMode(effectiveNetworkMode);
  const poolChainClient = useMemo(
    () => createNetworkClient(effectiveNetworkMode),
    [effectiveNetworkMode]
  );
  const poolConfig = poolId ? getPoolBySlug(poolId, effectiveNetworkMode) : null;
  const isUnifiedYield = mode === 'rehypo' && !!poolConfig?.yieldSources?.length;
  const token0Symbol = (poolConfig?.currency0.symbol || stateToken0Symbol) as TokenSymbol | undefined;
  const token1Symbol = (poolConfig?.currency1.symbol || stateToken1Symbol) as TokenSymbol | undefined;

  const token0Config = token0Symbol ? getToken(token0Symbol, effectiveNetworkMode) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol, effectiveNetworkMode) : null;

  const hookAddress = poolConfig?.hooks as Address | undefined;

  const createPriceSymbols = useMemo(
    () => [token0Symbol, token1Symbol].filter(Boolean) as string[],
    [token0Symbol, token1Symbol]
  );
  const { prices: createPrices } = useTokenPrices(createPriceSymbols, { chainId });
  const token0USDPrice = token0Symbol ? (createPrices[token0Symbol] || null) : null;
  const token1USDPrice = token1Symbol ? (createPrices[token1Symbol] || null) : null;

  const { currentSlippage } = useUserSlippageTolerance();
  const slippageToleranceBps = Math.round(currentSlippage * 100);

  const [transactionError, setTransactionError] = useState<string | boolean>(false);

  const [syncedAmounts, setSyncedAmounts] = useState<{ TOKEN0: string; TOKEN1: string } | null>(null);
  const syncAmountsFromApi = useCallback(
    (
      raw: { TOKEN0: string; TOKEN1: string },
      decimals: { decimals0: number; decimals1: number },
    ) => {
      const sym0 = token0Symbol as TokenSymbol | undefined;
      const sym1 = token1Symbol as TokenSymbol | undefined;
      setSyncedAmounts({
        TOKEN0: formatTokenDisplayAmount(formatUnits(BigInt(raw.TOKEN0), decimals.decimals0), sym0, effectiveNetworkMode),
        TOKEN1: formatTokenDisplayAmount(formatUnits(BigInt(raw.TOKEN1), decimals.decimals1), sym1, effectiveNetworkMode),
      });
    },
    [token0Symbol, token1Symbol, effectiveNetworkMode],
  );
  const clearSyncedAmounts = useCallback(() => setSyncedAmounts(null), []);

  const {
    calculate: triggerCalculation,
    calculatedData,
    isCalculating,
    error: calculationError,
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
  } = useAddLiquidityCalculation({
    poolId: poolId || undefined,
    token0Symbol: token0Symbol || 'atUSDC' as TokenSymbol,
    token1Symbol: token1Symbol || 'atDAI' as TokenSymbol,
    chainId,
    networkMode: effectiveNetworkMode,
  });

  useEffect(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return;

    const tickLowerNum = tickLower !== null ? tickLower : parseInt(String(ticks[0] || '0'));
    const tickUpperNum = tickUpper !== null ? tickUpper : parseInt(String(ticks[1] || '0'));

    const activeInputSide = inputSide === 'token0' ? 'amount0' : inputSide === 'token1' ? 'amount1' : null;
    const primaryAmount = activeInputSide === 'amount0' ? amount0 : amount1;

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

  useEffect(() => {
    if (calculationError) {
      setTransactionError(calculationError);
    }
  }, [calculationError]);

  const { depositPreview, isCalculating: isUnifiedYieldCalculating } = useUnifiedYieldDepositPreview({
    isUnifiedYield,
    hookAddress,
    poolChainClient,
    inputSide,
    amount0,
    amount1,
    token0Decimals: token0Config?.decimals,
    token1Decimals: token1Config?.decimals,
    networkMode: effectiveNetworkMode,
    chainId,
  });

  const {
    data: unifiedYieldApprovalStatus,
    refetch: refetchUnifiedYieldApprovals,
  } = useUnifiedYieldApprovals(
    {
      userAddress: accountAddress as Address | undefined,
      token0Address: poolConfig?.currency0.address as Address | undefined,
      token1Address: poolConfig?.currency1.address as Address | undefined,
      amount0Wei: depositPreview?.amount0 ?? 0n,
      amount1Wei: depositPreview?.amount1 ?? 0n,
      hookAddress,
      chainId,
    },
    { enabled: isUnifiedYield && !!depositPreview && !!accountAddress },
  );

  const activeInputSide = inputSide === 'token0' ? 'amount0' : inputSide === 'token1' ? 'amount1' : null;
  const primaryAmount = activeInputSide === 'amount0' ? amount0 : amount1;
  const inputTokenForQuery = activeInputSide === 'amount0' ? token0Symbol : token1Symbol;

  const queryTickLower = calculatedData?.finalTickLower ?? tickLower ?? (ticks[0] !== null ? parseInt(String(ticks[0])) : undefined);
  const queryTickUpper = calculatedData?.finalTickUpper ?? tickUpper ?? (ticks[1] !== null ? parseInt(String(ticks[1])) : undefined);

  const { gasFee: preparedGasFee } = usePrepareMintQuery(
    {
      userAddress: accountAddress as Address | undefined,
      poolId: poolId || undefined,
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
      refetchInterval: 10000,
      staleTime: 5000,
    }
  );

  const { gasFeeFormatted } = useGasFeeEstimate({
    gasFeeWei: preparedGasFee,
    skip: preparedGasFee == null,
  });

  const inputError = useMemo((): ReactNode | undefined => {
    if (!token0Symbol || !token1Symbol) return 'Select tokens';
    if (tickLower === null || tickUpper === null) return 'Select price range';
    if (tickLower >= tickUpper) return 'Invalid price range';
    const amt0 = parseFloat(amount0 || '0');
    const amt1 = parseFloat(amount1 || '0');
    if (amt0 <= 0 && amt1 <= 0) return 'Enter an amount';
    return undefined;
  }, [token0Symbol, token1Symbol, tickLower, tickUpper, amount0, amount1]);

  const formattedAmounts = useMemo(() => {
    if (isUnifiedYield && depositPreview) {
      return {
        TOKEN0: depositPreview.amount0Formatted || '0',
        TOKEN1: depositPreview.amount1Formatted || '0',
      };
    }
    return {
      TOKEN0: amount0 || '0',
      TOKEN1: dependentField === 'amount1' && dependentAmount ? dependentAmount : (amount1 || '0'),
    };
  }, [isUnifiedYield, depositPreview, amount0, amount1, dependentAmount, dependentField]);

  const usdValues = useMemo(() => {
    const amt0 = parseFloat(formattedAmounts.TOKEN0 || '0');
    const amt1 = parseFloat(formattedAmounts.TOKEN1 || '0');
    const usd0 = token0USDPrice ? (amt0 * token0USDPrice).toFixed(2) : '0.00';
    const usd1 = token1USDPrice ? (amt1 * token1USDPrice).toFixed(2) : '0.00';
    return { TOKEN0: usd0, TOKEN1: usd1 };
  }, [formattedAmounts, token0USDPrice, token1USDPrice]);

  const gasFeeEstimateUSD = gasFeeFormatted;

  // `needsToken{0,1}Approval` are placeholders kept on the type for back-compat
  // with consumers that read txInfo. The truth comes from `apiResponse.needsApproval`
  // returned by /api/liquidity/prepare-{mint,increase}-tx and is consumed in
  // ReviewExecuteModal's generateSteps, not from here.
  const txInfo = useMemo((): CreatePositionTxInfo | undefined => {
    if (!token0Symbol || !token1Symbol) return undefined;

    if (isUnifiedYield) {
      if (!depositPreview || depositPreview.shares <= 0n) return undefined;
      return {
        needsToken0Approval: unifiedYieldApprovalStatus?.token0NeedsApproval ?? false,
        needsToken1Approval: unifiedYieldApprovalStatus?.token1NeedsApproval ?? false,
        amount0Wei: depositPreview.amount0.toString(),
        amount1Wei: depositPreview.amount1.toString(),
        tickLower: 0,
        tickUpper: 0,
        liquidity: '0',
        sharesToMint: depositPreview.shares,
        isUnifiedYield: true,
      };
    }

    if (!calculatedData) return undefined;

    return {
      needsToken0Approval: false,
      needsToken1Approval: false,
      amount0Wei: calculatedData.amount0,
      amount1Wei: calculatedData.amount1,
      tickLower: calculatedData.finalTickLower,
      tickUpper: calculatedData.finalTickUpper,
      liquidity: calculatedData.liquidity,
      isUnifiedYield: false,
    };
  }, [isUnifiedYield, calculatedData, depositPreview, token0Symbol, token1Symbol, unifiedYieldApprovalStatus]);

  const effectiveDependentAmount = useMemo(() => {
    if (isUnifiedYield && depositPreview) {
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
      unifiedYieldApprovalStatus: unifiedYieldApprovalStatus ?? null,
      refetchUnifiedYieldApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      slippageTolerance: currentSlippage,
      depositPreview,
      isUnifiedYield,
      syncedAmounts,
      syncAmountsFromApi,
      clearSyncedAmounts,
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
      unifiedYieldApprovalStatus,
      refetchUnifiedYieldApprovals,
      inputError,
      formattedAmounts,
      usdValues,
      currentSlippage,
      depositPreview,
      syncedAmounts,
      syncAmountsFromApi,
      clearSyncedAmounts,
    ]
  );

  return (
    <CreatePositionTxContext.Provider value={value}>
      {children}
    </CreatePositionTxContext.Provider>
  );
}

export function useCreatePositionTxContext(): CreatePositionTxContextType {
  const context = useContext(CreatePositionTxContext);
  if (!context) {
    throw new Error('`useCreatePositionTxContext` must be used inside of `CreatePositionTxContextProvider`');
  }
  return context;
}
