'use client';

/**
 * ReviewExecuteModal - Modal for reviewing and executing liquidity position
 *
 * Uses Uniswap's step-based executor pattern:
 * 1. Token approvals (if needed)
 * 2. Permit2 signature (separate step)
 * 3. Position creation transaction
 *
 * @see interface/apps/web/src/components/Liquidity/ReviewModal.tsx
 * @see lib/liquidity/transaction/executor/useLiquidityStepExecutor.ts
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { IconXmark } from 'nucleo-micro-bold-essential';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { parseUnits, type Address } from 'viem';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import { getPoolById, getAllTokens, getToken, type TokenSymbol } from '@/lib/pools-config';
import { PositionRangeChart } from '@/components/liquidity/PositionRangeChart/PositionRangeChart';
import { PositionStatus } from '@/lib/uniswap/liquidity/pool-types';
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';
import { useNetwork } from '@/lib/network-context';
import { getStoredUserSettings } from '@/hooks/useUserSettings';

// Uniswap step-based executor
import {
  useLiquidityStepExecutor,
  buildLiquidityTxContext,
  generateLPTransactionSteps,
  type MintTxApiResponse,
} from '@/lib/liquidity/transaction';
import {
  LiquidityTransactionType,
  type TransactionStep,
  type ValidatedLiquidityTxContext,
} from '@/lib/liquidity/types';

// C4: Flow state tracking
import {
  getOrCreateFlowState,
  clearFlowState,
  clearCachedPermit,
} from '@/lib/permit-types';

// Progress indicator
import { ProgressIndicator } from '@/components/transactions';
import {
  type CurrentStepState,
  type TransactionStep as UITransactionStep,
  TransactionStepType as UIStepType,
} from '@/lib/transactions';

// Map executor step types to UI step types
function mapExecutorStepsToUI(
  executorSteps: TransactionStep[],
  pool: { currency0: { symbol: string; address: string }; currency1: { symbol: string; address: string } } | null,
  token0Icon?: string,
  token1Icon?: string
): UITransactionStep[] {
  if (!pool) return [];

  return executorSteps.map((step): UITransactionStep => {
    switch (step.type) {
      case 'TokenApproval':
      case 'TokenRevocation': {
        const tokenSymbol = (step as any).token?.symbol || pool.currency0.symbol;
        const tokenAddress = (step as any).token?.address || pool.currency0.address;
        const isToken0 = tokenAddress.toLowerCase() === pool.currency0.address.toLowerCase();
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol,
          tokenAddress,
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      case 'Permit2Signature':
        return { type: UIStepType.Permit2Signature };

      case 'IncreasePositionTransaction':
      case 'IncreasePositionTransactionAsync':
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      case 'DecreasePositionTransaction':
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      case 'CollectFeesTransaction':
        return {
          type: UIStepType.CollectFeesTransactionStep,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      default:
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };
    }
  });
}

// Token info row - Uniswap style: amount + symbol large, USD below, logo on right
interface TokenInfoRowProps {
  symbol: string;
  icon?: string;
  amount: string;
  usdValue?: string;
}

function TokenInfoRow({ symbol, icon, amount, usdValue }: TokenInfoRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xl font-semibold text-white">
          {amount || '0'} {symbol}
        </span>
        {usdValue && (
          <span className="text-sm text-muted-foreground">${usdValue}</span>
        )}
      </div>
      {icon ? (
        <Image
          src={icon}
          alt={symbol}
          width={36}
          height={36}
          className="rounded-full"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
          {symbol.charAt(0)}
        </div>
      )}
    </div>
  );
}

// Double token logo component
function DoubleCurrencyLogo({
  icon0,
  icon1,
  symbol0,
  symbol1,
}: {
  icon0?: string;
  icon1?: string;
  symbol0: string;
  symbol1: string;
}) {
  return (
    <div className="flex items-center -space-x-2">
      {icon0 ? (
        <Image src={icon0} alt={symbol0} width={36} height={36} className="rounded-full ring-2 ring-container" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ring-2 ring-container">
          {symbol0.charAt(0)}
        </div>
      )}
      {icon1 ? (
        <Image src={icon1} alt={symbol1} width={36} height={36} className="rounded-full ring-2 ring-container" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ring-2 ring-container">
          {symbol1.charAt(0)}
        </div>
      )}
    </div>
  );
}

// Modal view types - error is shown inline, not as separate view (Uniswap pattern)
// No 'success' view - on success we close modal and navigate (Uniswap pattern)
type ModalView = 'review' | 'executing';

// Error callout component - inline error display like Uniswap's ErrorCallout
// Enhanced for C2-C5 permit error handling
function ErrorCallout({
  error,
  onRetry,
  isPermitError,
  onRefreshPermit,
}: {
  error: string | null;
  onRetry: () => void;
  isPermitError?: boolean;
  onRefreshPermit?: () => void;
}) {
  if (!error) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-400">{error}</p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={onRetry}
            className="text-xs text-red-400 hover:text-red-300 underline"
          >
            Try again
          </button>
          {isPermitError && onRefreshPermit && (
            <button
              onClick={onRefreshPermit}
              className="text-xs text-blue-400 hover:text-blue-300 underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Sign new permit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReviewExecuteModal() {
  const router = useRouter();
  const { address } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const { state, closeReviewModal, reset, poolStateData } = useAddLiquidityContext();

  // Get transaction data from TxContext
  const {
    txInfo,
    calculatedData,
    usdValues,
    gasFeeEstimateUSD,
  } = useCreatePositionTxContext();

  // Refunded amounts (populated during migrations or when position manager returns excess)
  const refundedAmounts = useMemo(() => {
    return { token0: null as string | null, token1: null as string | null };
  }, []);

  // Modal state
  const [view, setView] = useState<ModalView>('review');
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepAccepted, setStepAccepted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPermitError, setIsPermitError] = useState(false);
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);
  // C4: Flow tracking for recovery
  const [flowId, setFlowId] = useState<string | undefined>(undefined);

  // Get pool and token info
  const pool = state.poolId ? getPoolById(state.poolId) : null;
  const tokens = getAllTokens();
  const token0Config = pool ? tokens[pool.currency0.symbol] : null;
  const token1Config = pool ? tokens[pool.currency1.symbol] : null;

  // Map executor steps to UI steps for ProgressIndicator
  const uiSteps = useMemo(() => {
    return mapExecutorStepsToUI(executorSteps, pool, token0Config?.icon, token1Config?.icon);
  }, [executorSteps, pool, token0Config?.icon, token1Config?.icon]);

  // Compute currentStep for ProgressIndicator
  const currentStep = useMemo((): CurrentStepState | undefined => {
    if (uiSteps.length === 0 || currentStepIndex >= uiSteps.length) return undefined;
    return { step: uiSteps[currentStepIndex], accepted: stepAccepted };
  }, [uiSteps, currentStepIndex, stepAccepted]);

  // Uniswap step-based executor
  const executor = useLiquidityStepExecutor({
    onSuccess: async () => {
      setIsExecuting(false);
      setCurrentStepIndex(0);
      setStepAccepted(false);

      // C4: Clear flow state and cached permit on success
      if (flowId) {
        clearFlowState(flowId);
      }
      if (address && chainId && pool) {
        clearCachedPermit(address, chainId, pool.currency0.symbol, pool.currency1.symbol);
      }

      closeReviewModal();
      reset();
      router.push('/overview');
    },
    onFailure: (err) => {
      setIsExecuting(false);
      const errorMessage = err?.message || 'Transaction failed';
      const isUserRejection =
        errorMessage.toLowerCase().includes('user rejected') ||
        errorMessage.toLowerCase().includes('user denied');

      setView('review');
      setCurrentStepIndex(0);
      setStepAccepted(false);

      if (!isUserRejection) {
        const isNonceError = errorMessage.includes('nonce') || errorMessage.includes('InvalidNonce');
        if (isNonceError) {
          setError('The permit signature has expired. Please try again.');
          setIsPermitError(true);
        } else {
          setError(errorMessage);
          setIsPermitError(false);
        }
      }
    },
    onStepChange: (stepIndex, _step, accepted) => {
      setCurrentStepIndex(stepIndex);
      setStepAccepted(accepted);
    },
  });

  // Get tick data for price calculations
  const tickLower = txInfo?.tickLower ?? state.tickLower ?? 0;
  const tickUpper = txInfo?.tickUpper ?? state.tickUpper ?? 0;

  // Use Uniswap's price ordering hooks for proper tick-to-price conversion
  // This matches how PositionCardCompact handles chart prices
  // Note: Must provide valid AND different addresses when pool is null (SDK requires unique addresses)
  const FALLBACK_TOKEN0_ADDRESS = '0x0000000000000000000000000000000000000001';
  const FALLBACK_TOKEN1_ADDRESS = '0x0000000000000000000000000000000000000002';
  const priceOrdering = usePriceOrdering({
    chainId,
    token0: {
      address: pool?.currency0.address || FALLBACK_TOKEN0_ADDRESS,
      symbol: pool?.currency0.symbol || 'TOKEN0',
      decimals: token0Config?.decimals ?? 18,
    },
    token1: {
      address: pool?.currency1.address || FALLBACK_TOKEN1_ADDRESS,
      symbol: pool?.currency1.symbol || 'TOKEN1',
      decimals: token1Config?.decimals ?? 18,
    },
    tickLower,
    tickUpper,
  });

  // Get formatted prices using Uniswap's display hook
  const { minPrice, maxPrice, isFullRange: isFullRangeFromHook } = useGetRangeDisplay({
    priceOrdering,
    pricesInverted: false,
    tickSpacing: pool?.tickSpacing,
    tickLower,
    tickUpper,
  });

  // Calculate price bounds for chart using the properly formatted values
  const chartPrices = useMemo(() => {
    // For Unified Yield (rehypo) mode, use the predefined range from pool config
    if (state.mode === 'rehypo' && pool?.rehypoRange) {
      // If rehypoRange is full range, use full range values
      if (pool.rehypoRange.isFullRange) {
        return { priceLower: 0, priceUpper: Number.MAX_SAFE_INTEGER };
      }
      // Use the predefined min/max from pool config
      const priceLower = parseFloat(pool.rehypoRange.min);
      const priceUpper = parseFloat(pool.rehypoRange.max);
      return { priceLower, priceUpper };
    }

    // For full range positions, the hook returns '0' and '∞'
    if (isFullRangeFromHook || state.isFullRange) {
      return { priceLower: 0, priceUpper: Number.MAX_SAFE_INTEGER };
    }

    // Parse the formatted prices for the chart
    const priceLower = minPrice && minPrice !== '-' && minPrice !== '∞'
      ? parseFloat(minPrice.replace(/,/g, ''))
      : undefined;
    const priceUpper = maxPrice && maxPrice !== '-' && maxPrice !== '∞'
      ? parseFloat(maxPrice.replace(/,/g, ''))
      : undefined;

    return { priceLower, priceUpper };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange]);

  // Use the hook's formatted prices for display
  const formattedPrices = useMemo(() => {
    // For Unified Yield (rehypo) mode, use the predefined range from pool config
    if (state.mode === 'rehypo' && pool?.rehypoRange) {
      if (pool.rehypoRange.isFullRange) {
        return { min: '0', max: '∞' };
      }
      return { min: pool.rehypoRange.min, max: pool.rehypoRange.max };
    }

    if (isFullRangeFromHook || state.isFullRange) {
      return { min: '0', max: '∞' };
    }
    return { min: minPrice || '-', max: maxPrice || '-' };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange]);

  // Determine position status for chart (new position is always in-range initially)
  const chartPositionStatus = useMemo(() => {
    const currentTick = poolStateData?.currentPoolTick;
    if (currentTick === null || currentTick === undefined || !txInfo) {
      return PositionStatus.IN_RANGE;
    }

    const tickLower = txInfo.tickLower;
    const tickUpper = txInfo.tickUpper;

    if (currentTick >= tickLower && currentTick <= tickUpper) {
      return PositionStatus.IN_RANGE;
    }
    return PositionStatus.OUT_OF_RANGE;
  }, [poolStateData, txInfo]);

  // Fetch API data and build context for step executor
  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!pool || !address || !chainId) return null;

    const token0Symbol = pool.currency0.symbol as TokenSymbol;
    const token1Symbol = pool.currency1.symbol as TokenSymbol;
    const token0 = getToken(token0Symbol, networkMode);
    const token1 = getToken(token1Symbol, networkMode);

    if (!token0 || !token1) {
      throw new Error('Token configuration not found');
    }

    // Determine input token and amount
    const tl = calculatedData?.finalTickLower ?? txInfo?.tickLower ?? 0;
    const tu = calculatedData?.finalTickUpper ?? txInfo?.tickUpper ?? 0;

    let inputAmount = state.amount0 || state.amount1 || '0';
    let inputTokenSymbol = token0Symbol;

    if (state.inputSide === 'token0') {
      inputAmount = state.amount0 || '0';
      inputTokenSymbol = token0Symbol;
    } else if (state.inputSide === 'token1') {
      inputAmount = state.amount1 || '0';
      inputTokenSymbol = token1Symbol;
    }

    // Get user settings
    const userSettings = getStoredUserSettings();
    const slippageBps = Math.round(userSettings.slippage * 100);
    const deadlineMinutes = userSettings.deadline;

    // Call API to get permit data
    const response = await fetch('/api/liquidity/prepare-mint-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address,
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol,
        userTickLower: tl,
        userTickUpper: tu,
        chainId,
        slippageBps,
        deadlineMinutes,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to prepare transaction');
    }

    const apiResponse: MintTxApiResponse = await response.json();

    // Build context for step executor
    // Note: API returns raw amounts (wei), but state amounts are display amounts.
    // CurrencyAmount.fromRawAmount expects raw amounts, so convert state amounts if needed.
    const getRawAmount0 = (): string => {
      if (apiResponse.details?.token0.amount) {
        return apiResponse.details.token0.amount; // Already raw (wei)
      }
      // Convert display amount to raw using parseUnits
      try {
        return parseUnits(state.amount0 || '0', token0.decimals).toString();
      } catch {
        return '0';
      }
    };

    const getRawAmount1 = (): string => {
      if (apiResponse.details?.token1.amount) {
        return apiResponse.details.token1.amount; // Already raw (wei)
      }
      // Convert display amount to raw using parseUnits
      try {
        return parseUnits(state.amount1 || '0', token1.decimals).toString();
      } catch {
        return '0';
      }
    };

    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Create,
      apiResponse,
      token0: {
        address: token0.address as Address,
        symbol: token0.symbol,
        decimals: token0.decimals,
        chainId,
      },
      token1: {
        address: token1.address as Address,
        symbol: token1.symbol,
        decimals: token1.decimals,
        chainId,
      },
      amount0: getRawAmount0(),
      amount1: getRawAmount1(),
      chainId,
      // Pass request args for async step - needed to call API with signature after permit
      // Uniswap pattern: batchPermitData is embedded in request args so it's available
      // when getTxRequest(signature) is called after user signs the permit
      createPositionRequestArgs: {
        userAddress: address,
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol,
        userTickLower: tl,
        userTickUpper: tu,
        chainId,
        slippageBps,
        deadlineMinutes,
        permitBatchData: apiResponse.permitBatchData,
      },
    });

    return context as ValidatedLiquidityTxContext;
  }, [pool, address, chainId, networkMode, state, txInfo, calculatedData]);

  // Handle confirm
  const handleNormalConfirm = useCallback(async () => {
    if (!pool || !address) return;

    setView('executing');
    setIsExecuting(true);
    setError(null);
    setIsPermitError(false);

    // C4: Initialize flow tracking
    const tl = calculatedData?.finalTickLower ?? txInfo?.tickLower ?? state.tickLower ?? 0;
    const tu = calculatedData?.finalTickUpper ?? txInfo?.tickUpper ?? state.tickUpper ?? 0;
    const flow = getOrCreateFlowState(
      address,
      chainId || 0,
      pool.currency0.symbol,
      pool.currency1.symbol,
      tl,
      tu
    );
    setFlowId(flow.flowId);

    try {
      // Build context from API
      const context = await fetchAndBuildContext();
      if (!context) {
        throw new Error('Failed to build transaction context');
      }

      // Generate steps for UI display
      const steps = generateLPTransactionSteps(context);
      setExecutorSteps(steps);

      // Start with first step
      if (steps.length > 0) {
        setCurrentStepIndex(0);
        setStepAccepted(false);
      }

      // Execute using Uniswap step executor
      await executor.execute(context);
    } catch (err: any) {
      console.error('[ReviewExecuteModal] Transaction error:', err);
      setIsExecuting(false);
      setView('review');
      setError(err?.message || 'Transaction failed');
    }
  }, [pool, address, fetchAndBuildContext, executor, calculatedData, txInfo, state, chainId]);

  // Handle confirm - just call the normal flow
  const handleConfirm = handleNormalConfirm;

  // Clear error and retry
  const handleRetry = useCallback(() => {
    setError(null);
    setIsPermitError(false);
  }, []);

  // Handle permit refresh (retry the flow)
  const handleRefreshPermit = useCallback(() => {
    setError(null);
    setIsPermitError(false);
    // Auto-start the flow again
    handleConfirm();
  }, [handleConfirm]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isExecuting) {
      closeReviewModal();
    }
  }, [isExecuting, closeReviewModal]);

  // Reset state when modal opens
  useEffect(() => {
    if (state.isReviewModalOpen) {
      setView('review');
      setCurrentStepIndex(0);
      setStepAccepted(false);
      setExecutorSteps([]);
      setIsExecuting(false);
      setError(null);
      setIsPermitError(false);
    }
  }, [state.isReviewModalOpen]);

  if (!pool) return null;

  return (
    <Dialog open={state.isReviewModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[420px] bg-container border-sidebar-border p-0 gap-0 [&>button]:hidden">
        {/* Review/Executing View - Uniswap pattern: content stays visible during transaction */}
        {(view === 'review' || view === 'executing') && (
          <div className="flex flex-col">
            {/* Header: Title + Close X */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-base font-medium text-muted-foreground">
                {view === 'executing' ? 'Creating position' : 'Add liquidity'}
              </span>
              <button
                onClick={handleClose}
                disabled={isExecuting}
                className="text-muted-foreground hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconXmark className="w-5 h-5" />
              </button>
            </div>

            {/* Token Pair Section */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  {/* Token symbols */}
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-semibold text-white">
                      {pool.currency0.symbol}
                    </span>
                    <span className="text-2xl font-semibold text-muted-foreground">/</span>
                    <span className="text-2xl font-semibold text-white">
                      {pool.currency1.symbol}
                    </span>
                  </div>
                  {/* Position type badge */}
                  <div className="flex items-center gap-2">
                    {state.mode === 'rehypo' ? (
                      <span
                        className="text-xs font-medium px-2.5 py-1 rounded-lg border border-transparent hover:border-[#9896FF]/50 transition-colors"
                        style={{ backgroundColor: 'rgba(152, 150, 255, 0.10)', color: '#9896FF' }}
                      >
                        Unified Yield
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-muted-foreground">
                        Custom
                      </span>
                    )}
                  </div>
                </div>
                {/* Double token logo */}
                <DoubleCurrencyLogo
                  icon0={token0Config?.icon}
                  icon1={token1Config?.icon}
                  symbol0={pool.currency0.symbol}
                  symbol1={pool.currency1.symbol}
                />
              </div>

              {/* Chart - use subgraphId for GraphQL data fetching */}
              {pool.subgraphId && (
                <div className="mt-4">
                  <PositionRangeChart
                    poolId={pool.subgraphId}
                    token0={pool.currency0.symbol}
                    token1={pool.currency1.symbol}
                    priceInverted={false}
                    positionStatus={chartPositionStatus}
                    priceLower={chartPrices.priceLower}
                    priceUpper={chartPrices.priceUpper}
                    height={80}
                    className="w-full"
                  />
                </div>
              )}

              {/* Min / Max prices */}
              <div className="flex mt-3 gap-4">
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground">Min</span>
                  <p className="text-sm text-white">
                    {formattedPrices.min} {pool.currency1.symbol} per {pool.currency0.symbol}
                  </p>
                </div>
                <div className="flex-1">
                  <span className="text-xs text-muted-foreground">Max</span>
                  <p className="text-sm text-white">
                    {formattedPrices.max} {pool.currency1.symbol} per {pool.currency0.symbol}
                  </p>
                </div>
              </div>
            </div>

            {/* Depositing Section */}
            <div className="px-4 py-3 mt-2">
              <span className="text-sm text-muted-foreground mb-3 block">Depositing</span>
              <div className="flex flex-col gap-4">
                {state.amount0 && parseFloat(state.amount0) > 0 && (
                  <TokenInfoRow
                    symbol={pool.currency0.symbol}
                    icon={token0Config?.icon}
                    amount={state.amount0}
                    usdValue={usdValues?.TOKEN0 || '0.00'}
                  />
                )}
                {state.amount1 && parseFloat(state.amount1) > 0 && (
                  <TokenInfoRow
                    symbol={pool.currency1.symbol}
                    icon={token1Config?.icon}
                    amount={state.amount1}
                    usdValue={usdValues?.TOKEN1 || '0.00'}
                  />
                )}
              </div>
            </div>

            {/* Refunded Amounts Section - shown only during migrations when excess tokens are returned */}
            {(refundedAmounts.token0 || refundedAmounts.token1) && (
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm text-muted-foreground">Refunded</span>
                  <div className="group relative">
                    <AlertCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-sidebar-accent rounded-lg text-xs text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Tokens returned from the position manager
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  {refundedAmounts.token0 && parseFloat(refundedAmounts.token0) > 0 && (
                    <TokenInfoRow
                      symbol={pool.currency0.symbol}
                      icon={token0Config?.icon}
                      amount={refundedAmounts.token0}
                    />
                  )}
                  {refundedAmounts.token1 && parseFloat(refundedAmounts.token1) > 0 && (
                    <TokenInfoRow
                      symbol={pool.currency1.symbol}
                      icon={token1Config?.icon}
                      amount={refundedAmounts.token1}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Error Callout - inline like Uniswap */}
            {error && (
              <div className="px-4 pb-2">
                <ErrorCallout
                  error={error}
                  onRetry={handleRetry}
                  isPermitError={isPermitError}
                  onRefreshPermit={handleRefreshPermit}
                />
              </div>
            )}

            {/* Network Cost - Uniswap pattern: shown before button, hidden during steps */}
            {gasFeeEstimateUSD && view !== 'executing' && (
              <>
                <div className="mx-4 border-t border-sidebar-border" />
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Network cost</span>
                  <div className="flex items-center gap-2">
                    {/* Chain icon - Base network */}
                    <div className="w-4 h-4 rounded-sm bg-blue-500 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z" fill="white"/>
                      </svg>
                    </div>
                    <span className="text-sm text-white">{gasFeeEstimateUSD}</span>
                  </div>
                </div>
              </>
            )}

            {/* Bottom Section: Button OR Progress Indicator */}
            <div className="p-4 pt-2">
              {view === 'executing' && currentStep && uiSteps.length > 0 ? (
                <ProgressIndicator steps={uiSteps} currentStep={currentStep} />
              ) : (
                <Button
                  onClick={handleConfirm}
                  className="w-full h-12 text-base font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
                >
                  Create
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
