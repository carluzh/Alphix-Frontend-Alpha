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
import { useAccount, usePublicClient } from 'wagmi';
import { AlertCircle, RotateCw, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { isUserRejectionError } from '@/lib/liquidity/utils/validation/errorHandling';
import { IconXmark } from 'nucleo-micro-bold-essential';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { parseUnits, type Address } from 'viem';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import dynamic from 'next/dynamic';
import { getPoolById, getAllTokens, getToken, type TokenSymbol } from '@/lib/pools-config';
import { cn } from '@/lib/utils';
import { PositionStatus } from '@/lib/uniswap/liquidity/pool-types';

const PositionRangeChart = dynamic(() => import('@/components/liquidity/PositionRangeChart/PositionRangeChart').then(mod => mod.PositionRangeChart), { ssr: false });
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

// Unified Yield transaction building
import { buildUnifiedYieldDepositTx, buildDepositParamsFromPreview } from '@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx';
import type { ValidatedTransactionRequest } from '@/lib/liquidity/types';

// Shared approval utilities
import { buildApprovalRequests as buildApprovalRequestsUtil } from '@/lib/liquidity/hooks/approval';
import {
  type CurrentStepState,
  type TransactionStep as UITransactionStep,
  TransactionStepType as UIStepType,
} from '@/lib/transactions';

// Zap (single-token deposit) support
import { useZapPreview, useZapApprovals, generateZapSteps, isPreviewFresh, isZapEligiblePool, type ZapToken } from '@/lib/liquidity/zap';

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

      // Unified Yield approval - direct ERC20 to Hook
      case 'UnifiedYieldApproval': {
        const uyStep = step as any;
        const isToken0 = uyStep.tokenSymbol === pool.currency0.symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: uyStep.tokenSymbol || pool.currency0.symbol,
          tokenAddress: uyStep.tokenAddress || '',
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      case 'Permit2Signature':
        return { type: UIStepType.Permit2Signature };

      case 'IncreasePositionTransaction':
      case 'IncreasePositionTransactionAsync':
      case 'UnifiedYieldDeposit': // UY deposit maps to create position UI
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

      // Zap (single-token deposit) steps
      case 'ZapSwapApproval': {
        const zapStep = step as any;
        const isToken0 = zapStep.inputToken === 'USDS' || zapStep.tokenSymbol === pool.currency0.symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: zapStep.tokenSymbol || (isToken0 ? pool.currency0.symbol : pool.currency1.symbol),
          tokenAddress: zapStep.tokenAddress || '',
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      case 'ZapPSMSwap': {
        const zapStep = step as any;
        const isToken0Input = zapStep.direction === 'USDS_TO_USDC';
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: isToken0Input ? pool.currency0.symbol : pool.currency1.symbol,
          outputTokenSymbol: isToken0Input ? pool.currency1.symbol : pool.currency0.symbol,
          inputTokenIcon: isToken0Input ? token0Icon : token1Icon,
          outputTokenIcon: isToken0Input ? token1Icon : token0Icon,
          routeType: 'psm' as const,
        };
      }

      case 'ZapPoolSwap': {
        const zapStep = step as any;
        const isToken0Input = zapStep.inputToken === 'USDS';
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: isToken0Input ? pool.currency0.symbol : pool.currency1.symbol,
          outputTokenSymbol: isToken0Input ? pool.currency1.symbol : pool.currency0.symbol,
          inputTokenIcon: isToken0Input ? token0Icon : token1Icon,
          outputTokenIcon: isToken0Input ? token1Icon : token0Icon,
          routeType: 'pool' as const,
        };
      }

      case 'ZapDynamicDeposit': {
        // Dynamic deposit step - shows as a deposit/create position step
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };
      }

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
        <Image src={icon0} alt={symbol0} width={36} height={36} className="rounded-full " />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ">
          {symbol0.charAt(0)}
        </div>
      )}
      {icon1 ? (
        <Image src={icon1} alt={symbol1} width={36} height={36} className="rounded-full " />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ">
          {symbol1.charAt(0)}
        </div>
      )}
    </div>
  );
}

// Modal view types - error is shown inline, not as separate view (Uniswap pattern)
// No 'success' view - on success we close modal and navigate (Uniswap pattern)
type ModalView = 'review' | 'executing';

// Simple error callout component with copy functionality
function ErrorCallout({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!error) return null;

  // Truncate long errors for display (keep first 120 chars)
  const MAX_ERROR_LENGTH = 120;
  const isLongError = error.length > MAX_ERROR_LENGTH;
  const displayError = isLongError && !expanded
    ? error.slice(0, MAX_ERROR_LENGTH) + '...'
    : error;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy error:', err);
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 overflow-hidden">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm text-red-400 break-words">
          {displayError}
        </p>
        {isLongError && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-red-400/70 hover:text-red-300 mt-1"
          >
            Show more
          </button>
        )}
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleCopy}
            className="text-xs text-muted-foreground hover:text-white transition-colors flex items-center gap-1"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={onRetry}
            className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
          >
            <RotateCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

// ERC20 balanceOf ABI for querying token balances
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function ReviewExecuteModal() {
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { chainId, networkMode } = useNetwork();
  const { state, closeReviewModal, reset, poolStateData } = useAddLiquidityContext();

  // Get transaction data from TxContext
  const {
    txInfo,
    calculatedData,
    usdValues,
    gasFeeEstimateUSD,
    depositPreview,
    isUnifiedYield,
    refetchApprovals,
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
  const [executorSteps, setExecutorSteps] = useState<TransactionStep[]>([]);
  const [isRefetchingPreview, setIsRefetchingPreview] = useState(false);
  // C4: Flow tracking for recovery
  const [flowId, setFlowId] = useState<string | undefined>(undefined);

  // Get pool and token info
  const pool = state.poolId ? getPoolById(state.poolId) : null;
  const tokens = getAllTokens();
  const token0Config = pool ? tokens[pool.currency0.symbol] : null;
  const token1Config = pool ? tokens[pool.currency1.symbol] : null;

  // Determine if using zap mode (only for USDS/USDC pool)
  const isZapMode = isUnifiedYield && isZapEligiblePool(state.poolId) && state.depositMode === 'zap' && state.zapInputToken !== null;
  const zapInputToken: ZapToken | undefined = isZapMode
    ? (state.zapInputToken === 'token0' ? 'USDS' : 'USDC')
    : undefined;
  const zapInputAmount = isZapMode
    ? (state.zapInputToken === 'token0' ? state.amount0 : state.amount1)
    : undefined;

  // Zap preview hook
  const zapPreviewQuery = useZapPreview({
    inputToken: zapInputToken ?? null,
    inputAmount: zapInputAmount || '',
    hookAddress: (pool?.hooks ?? '0x0000000000000000000000000000000000000000') as Address,
    enabled: isZapMode && !!zapInputToken && !!zapInputAmount && !!pool?.hooks,
    refetchEnabled: !isExecuting, // Disable refetch during transaction execution
  });

  // Live countdown for zap refetch timer
  const [zapRefetchCountdown, setZapRefetchCountdown] = useState(10);
  useEffect(() => {
    if (!isZapMode || zapPreviewQuery.isLoading || zapPreviewQuery.isFetching || isRefetchingPreview || isExecuting) {
      return;
    }
    // Calculate initial countdown based on when data was last updated
    const updateCountdown = () => {
      const elapsed = Date.now() - (zapPreviewQuery.dataUpdatedAt || Date.now());
      const remaining = Math.max(0, Math.ceil((10000 - elapsed) / 1000));
      setZapRefetchCountdown(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isZapMode, zapPreviewQuery.dataUpdatedAt, zapPreviewQuery.isLoading, zapPreviewQuery.isFetching, isRefetchingPreview, isExecuting]);

  // Zap approvals hook
  const zapApprovalsQuery = useZapApprovals({
    userAddress: address,
    inputToken: zapInputToken,
    swapAmount: zapPreviewQuery.data?.swapAmount,
    route: zapPreviewQuery.data?.route,
    hookAddress: pool?.hooks as Address,
    inputAmount: zapPreviewQuery.data?.swapAmount
      ? zapPreviewQuery.data.swapAmount + zapPreviewQuery.data.remainingInputAmount
      : undefined,
    enabled: isZapMode && !!zapPreviewQuery.data && !!address && !!pool?.hooks,
  });

  // Map executor steps to UI steps for ProgressIndicator
  const uiSteps = useMemo(() => {
    return mapExecutorStepsToUI(executorSteps, pool, token0Config?.icon, token1Config?.icon);
  }, [executorSteps, pool, token0Config?.icon, token1Config?.icon]);

  // Compute currentStep for ProgressIndicator
  const currentStep = useMemo((): CurrentStepState | undefined => {
    if (uiSteps.length === 0 || currentStepIndex >= uiSteps.length) return undefined;
    return { step: uiSteps[currentStepIndex], accepted: stepAccepted };
  }, [uiSteps, currentStepIndex, stepAccepted]);

  // Compute button disabled state
  const isCreateButtonDisabled = isZapMode
    ? !zapPreviewQuery.data || !zapApprovalsQuery.approvals || zapPreviewQuery.isLoading || zapPreviewQuery.isFetching || isRefetchingPreview
    : isUnifiedYield && !depositPreview;

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
      // Navigate FIRST before resetting state to prevent URL sync from interfering
      // The context will be recreated fresh when user returns to the wizard
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
        setError(errorMessage);
      }
    },
    onStepChange: (stepIndex, _step, accepted) => {
      setCurrentStepIndex(stepIndex);
      setStepAccepted(accepted);
    },
  });

  // Get tick data for price calculations
  // For Unified Yield: Use the pool config's rehypoRange ticks directly (same as RangeAndAmountsStep)
  const rehypoTickLower = pool?.rehypoRange?.min ? parseInt(pool.rehypoRange.min, 10) : null;
  const rehypoTickUpper = pool?.rehypoRange?.max ? parseInt(pool.rehypoRange.max, 10) : null;

  const tickLower = isUnifiedYield && rehypoTickLower !== null
    ? rehypoTickLower
    : (txInfo?.tickLower ?? state.tickLower ?? 0);
  const tickUpper = isUnifiedYield && rehypoTickUpper !== null
    ? rehypoTickUpper
    : (txInfo?.tickUpper ?? state.tickUpper ?? 0);

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
  // Note: For both Custom and Unified Yield modes, use the SDK-derived prices from priceOrdering hook
  const chartPrices = useMemo(() => {
    // For full range positions, the hook returns '0' and '∞'
    if (isFullRangeFromHook || state.isFullRange || (state.mode === 'rehypo' && pool?.rehypoRange?.isFullRange)) {
      return { priceLower: 0, priceUpper: Number.MAX_SAFE_INTEGER };
    }

    // Parse the formatted prices from the SDK hook for the chart
    // This works for both Custom and Unified Yield modes since both use tick values
    const priceLower = minPrice && minPrice !== '-' && minPrice !== '∞'
      ? parseFloat(minPrice.replace(/,/g, ''))
      : undefined;
    const priceUpper = maxPrice && maxPrice !== '-' && maxPrice !== '∞'
      ? parseFloat(maxPrice.replace(/,/g, ''))
      : undefined;

    return { priceLower, priceUpper };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange?.isFullRange]);

  // Use the hook's formatted prices for display
  // The useGetRangeDisplay hook already converts ticks to human-readable prices using the SDK
  const formattedPrices = useMemo(() => {
    if (isFullRangeFromHook || state.isFullRange || (state.mode === 'rehypo' && pool?.rehypoRange?.isFullRange)) {
      return { min: '0', max: '∞' };
    }
    // Use SDK-derived prices for both modes - these are already converted from ticks
    return { min: minPrice || '-', max: maxPrice || '-' };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange?.isFullRange]);

  const chartPositionStatus = useMemo(() => {
    const currentTick = poolStateData?.currentPoolTick;
    if (currentTick === null || currentTick === undefined) {
      return PositionStatus.IN_RANGE;
    }
    if (currentTick >= tickLower && currentTick <= tickUpper) {
      return PositionStatus.IN_RANGE;
    }
    return PositionStatus.OUT_OF_RANGE;
  }, [poolStateData?.currentPoolTick, tickLower, tickUpper]);

  // Wrapper for shared approval utility (adds chainId from context)
  const buildApprovalRequests = useCallback((params: {
    needsToken0: boolean;
    needsToken1: boolean;
    token0Address: Address;
    token1Address: Address;
    spender: Address;
    amount0: bigint;
    amount1: bigint;
  }) => buildApprovalRequestsUtil({ ...params, chainId: chainId! }), [chainId]);

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

    // =========================================================================
    // UNIFIED YIELD POSITIONS - Build context with deposit tx (no API call)
    // =========================================================================
    // For Unified Yield, we MUST have depositPreview and hooks - don't fall through to V4
    if (isUnifiedYield) {
      if (!depositPreview) {
        console.error('[ReviewExecuteModal] Unified Yield mode but depositPreview is missing');
        throw new Error('Deposit preview not available. Please enter an amount and try again.');
      }
      if (!pool.hooks) {
        console.error('[ReviewExecuteModal] Unified Yield mode but pool.hooks is missing');
        throw new Error('Pool hook address not configured');
      }
    }

    if (isUnifiedYield && depositPreview && pool.hooks) {
      const hookAddress = pool.hooks as Address;

      // CRITICAL: Refetch approvals fresh before building context
      // This prevents skipping approval steps based on stale cached data
      const freshApprovals = await refetchApprovals();
      const needsToken0 = freshApprovals.needsToken0ERC20Approval;
      const needsToken1 = freshApprovals.needsToken1ERC20Approval;

      // Build approval requests using fresh data
      const approvals = buildApprovalRequests({
        needsToken0,
        needsToken1,
        token0Address: token0.address as Address,
        token1Address: token1.address as Address,
        spender: hookAddress,
        amount0: depositPreview.amount0,
        amount1: depositPreview.amount1,
      });
      const approveToken0Request = approvals.token0;
      const approveToken1Request = approvals.token1;

      // Build deposit params from preview (with slippage protection)
      const sqrtPriceX96 = poolStateData?.sqrtPriceX96 ? BigInt(poolStateData.sqrtPriceX96) : undefined;
      const depositParams = buildDepositParamsFromPreview(
        depositPreview,
        hookAddress,
        token0.address as Address,
        token1.address as Address,
        address,
        state.poolId!,
        chainId,
        sqrtPriceX96,
        500, // 0.05% slippage
      );

      // Build deposit transaction
      const depositTx = buildUnifiedYieldDepositTx(depositParams);

      // Build context with UY-specific fields
      const context = buildLiquidityTxContext({
        type: LiquidityTransactionType.Create,
        apiResponse: {
          needsApproval: false,
          create: {
            to: depositTx.to,
            data: depositTx.calldata,
            value: depositTx.value?.toString() || '0',
            gasLimit: depositTx.gasLimit?.toString(),
            chainId,
          },
          sqrtRatioX96: undefined,
        } as MintTxApiResponse,
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
        amount0: depositPreview.amount0.toString(),
        amount1: depositPreview.amount1.toString(),
        chainId,
        approveToken0Request,
        approveToken1Request,
        // Unified Yield specific fields
        isUnifiedYield: true,
        hookAddress,
        poolId: state.poolId!,
        sharesToMint: depositPreview.shares,
      });

      return context as ValidatedLiquidityTxContext;
    }

    // =========================================================================
    // V4 POSITIONS - Call API to build transaction
    // =========================================================================

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

    // Build ERC20 approval requests using shared helper (same as Unified Yield)
    // Use the new needsToken0Approval/needsToken1Approval flags from API to handle both tokens
    // Fallback to legacy address comparison for backwards compatibility
    const needsToken0 = apiResponse.needsToken0Approval ??
      (apiResponse.approvalTokenAddress?.toLowerCase() === token0.address.toLowerCase());
    const needsToken1 = apiResponse.needsToken1Approval ??
      (apiResponse.approvalTokenAddress?.toLowerCase() === token1.address.toLowerCase());

    const v4Approvals = apiResponse.erc20ApprovalNeeded && apiResponse.approveToAddress
      ? buildApprovalRequests({
          needsToken0,
          needsToken1,
          token0Address: token0.address as Address,
          token1Address: token1.address as Address,
          spender: apiResponse.approveToAddress as Address,
          amount0: BigInt(getRawAmount0()),
          amount1: BigInt(getRawAmount1()),
        })
      : {};
    const v4ApproveToken0Request = v4Approvals.token0;
    const v4ApproveToken1Request = v4Approvals.token1;

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
      // Pass ERC20 approval requests if needed (for approval step before permit)
      approveToken0Request: v4ApproveToken0Request,
      approveToken1Request: v4ApproveToken1Request,
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
  }, [pool, address, chainId, networkMode, state, txInfo, calculatedData, isUnifiedYield, depositPreview, buildApprovalRequests]);

  // Handle confirm - unified for V4, Unified Yield, and Zap modes
  const handleConfirm = useCallback(async () => {
    if (!pool || !address) return;

    setView('executing');
    setIsExecuting(true);
    setError(null);

    // =======================================================================
    // ZAP MODE - Single-token deposit with auto-swap
    // =======================================================================
    if (isZapMode && zapPreviewQuery.data && zapApprovalsQuery.approvals) {
      try {
        // Generate zap steps
        const hookAddress = pool.hooks as Address;
        let preview = zapPreviewQuery.data;

        // Check if preview is stale and refetch if needed
        // Preview is stale if older than MAX_PREVIEW_AGE_MS (30 seconds)
        if (!isPreviewFresh(preview)) {
          console.log('[ReviewExecuteModal] Zap preview is stale, refetching...');
          setIsRefetchingPreview(true);
          try {
            const freshPreview = await zapPreviewQuery.refetch();
            if (!freshPreview.data) {
              throw new Error('Failed to refresh zap preview');
            }
            preview = freshPreview.data;
          } finally {
            setIsRefetchingPreview(false);
          }
        }

        // Get user settings for slippage and approval mode
        const userSettings = getStoredUserSettings();

        // Calculate token amounts after swap
        // If input is USDS (token0): we have remaining USDS + swapped USDC
        // If input is USDC (token1): we have swapped USDS + remaining USDC
        const inputToken = preview.inputTokenInfo.symbol as ZapToken;
        const token0Amount = inputToken === 'USDS'
          ? preview.remainingInputAmount  // Remaining USDS
          : preview.swapOutputAmount;      // USDS from swap
        const token1Amount = inputToken === 'USDC'
          ? preview.remainingInputAmount  // Remaining USDC
          : preview.swapOutputAmount;      // USDC from swap

        // Apply haircut to shares to account for yield accrual between preview and execution
        // The pool accrues yield block-by-block, so requesting the exact preview shares
        // may fail if yield was distributed. Request slightly fewer shares (0.1% less).
        const sharesWithHaircut = (preview.expectedShares * 999n) / 1000n;

        // Query initial balances for dust tracking
        // These are recorded before any swaps so we can calculate dust delta after deposit
        let initialBalance0: bigint | undefined;
        let initialBalance1: bigint | undefined;
        if (publicClient) {
          try {
            const [balance0, balance1] = await Promise.all([
              publicClient.readContract({
                address: pool.currency0.address as Address,
                abi: ERC20_BALANCE_ABI,
                functionName: 'balanceOf',
                args: [address],
              }) as Promise<bigint>,
              publicClient.readContract({
                address: pool.currency1.address as Address,
                abi: ERC20_BALANCE_ABI,
                functionName: 'balanceOf',
                args: [address],
              }) as Promise<bigint>,
            ]);
            initialBalance0 = balance0;
            initialBalance1 = balance1;
            console.log('[ReviewExecuteModal] Initial balances for dust tracking:', {
              token0: balance0.toString(),
              token1: balance1.toString(),
            });
          } catch (balanceError) {
            console.warn('[ReviewExecuteModal] Failed to query initial balances:', balanceError);
          }
        }

        // Calculate input amount in USD (stablecoins ≈ $1)
        const inputDecimals = inputToken === 'USDS' ? 18 : 6;
        const inputAmountUSD = Number(preview.formatted.inputAmount);

        const zapStepsResult = generateZapSteps({
          calculation: preview,
          approvals: zapApprovalsQuery.approvals,
          hookAddress,
          userAddress: address,
          sharesToMint: sharesWithHaircut,
          slippageTolerance: userSettings.slippage,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          poolId: state.poolId!,
          inputToken,
          token0Address: pool.currency0.address as Address,
          token1Address: pool.currency1.address as Address,
          token0Amount,
          token1Amount,
          approvalMode: userSettings.approvalMode,
          initialBalance0,
          initialBalance1,
          inputAmountUSD,
        });

        // Cast zap steps to TransactionStep[] for UI display
        const steps = zapStepsResult.steps as unknown as TransactionStep[];
        setExecutorSteps(steps);

        // Start with first step
        if (steps.length > 0) {
          setCurrentStepIndex(0);
          setStepAccepted(false);
        }

        // Build a minimal context for zap execution
        // Zap steps are self-contained and don't need the full V4 context
        const zapContext = {
          type: LiquidityTransactionType.Create,
          isZapMode: true,
          zapSteps: zapStepsResult.steps,
          hookAddress,
          chainId,
        };

        // Execute using the step executor
        // Note: The executor will use the registry to handle zap steps
        await executor.execute(zapContext as any);
      } catch (err: any) {
        console.error('[ReviewExecuteModal] Zap transaction error:', err);
        // Capture non-rejection errors to Sentry
        if (!isUserRejectionError(err)) {
          Sentry.captureException(err, {
            tags: { component: 'ReviewExecuteModal', operation: 'zapTransaction' },
            extra: {
              poolId: pool?.id,
              userAddress: address,
              chainId,
              isZapMode: true,
            },
          });
        }
        setIsExecuting(false);
        setView('review');
        setError(err?.message || 'Zap transaction failed');
      }
      return;
    }

    // =======================================================================
    // STANDARD MODE - V4 or balanced Unified Yield deposit
    // =======================================================================

    // V4 uses permit flow state tracking
    if (!isUnifiedYield) {
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
    }

    try {
      // Unified execution path - works for both V4 and Unified Yield
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
      // Capture non-rejection errors to Sentry
      if (!isUserRejectionError(err)) {
        Sentry.captureException(err, {
          tags: { component: 'ReviewExecuteModal', operation: 'transaction' },
          extra: {
            poolId: pool?.id,
            userAddress: address,
            chainId,
            isUnifiedYield,
          },
        });
      }
      setIsExecuting(false);
      setView('review');
      setError(err?.message || 'Transaction failed');
    }
  }, [pool, address, fetchAndBuildContext, executor, calculatedData, txInfo, state, chainId, isUnifiedYield, isZapMode, zapPreviewQuery.data, zapApprovalsQuery.approvals]);

  // Clear error and retry
  const handleRetry = useCallback(() => {
    setError(null);
  }, []);

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
                {view === 'executing'
                  ? (isUnifiedYield ? 'Depositing to Unified Yield' : 'Creating position')
                  : (isUnifiedYield ? 'Unified Yield Deposit' : 'Add liquidity')}
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
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">
                  {isZapMode ? 'Zap Deposit' : 'Depositing'}
                </span>
                {/* Zap mode status badge */}
                {isZapMode && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      zapPreviewQuery.isLoading || zapPreviewQuery.isFetching || isRefetchingPreview
                        ? 'bg-muted/50 text-muted-foreground animate-pulse'
                        : 'bg-muted/30 text-muted-foreground/80'
                    }`}
                  >
                    {zapPreviewQuery.isLoading || zapPreviewQuery.isFetching || isRefetchingPreview
                      ? 'Calculating...'
                      : `Refetches in ${zapRefetchCountdown}s`
                    }
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {/* Zap mode loading state - show known values, skeleton for calculated */}
                {isZapMode && (zapPreviewQuery.isLoading || zapPreviewQuery.isFetching || isRefetchingPreview) && (
                  <>
                    {/* Input token - show actual values (already known) */}
                    <TokenInfoRow
                      symbol={zapInputToken === 'USDS' ? pool.currency0.symbol : pool.currency1.symbol}
                      icon={zapInputToken === 'USDS' ? token0Config?.icon : token1Config?.icon}
                      amount={zapInputAmount || '0'}
                      usdValue={usdValues?.[zapInputToken === 'USDS' ? 'TOKEN0' : 'TOKEN1'] || '0.00'}
                    />
                    {/* Skeleton for calculated Swap info */}
                    <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Swap amount</span>
                        <div className="h-4 w-24 bg-muted/40 rounded animate-pulse" />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Route</span>
                        <div className="h-4 w-28 bg-muted/40 rounded animate-pulse" />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Expected shares</span>
                        <div className="h-4 w-32 bg-muted/40 rounded animate-pulse" />
                      </div>
                    </div>
                  </>
                )}
                {/* Zap mode error state */}
                {isZapMode && zapPreviewQuery.isError && !zapPreviewQuery.isFetching && (
                  <div className="flex flex-col gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <span className="text-sm text-red-400">Failed to calculate zap preview</span>
                    <span className="text-xs text-muted-foreground">{zapPreviewQuery.error?.message}</span>
                  </div>
                )}
                {/* Zap mode: Show single input token with swap info */}
                {isZapMode && !zapPreviewQuery.isLoading && !zapPreviewQuery.isFetching && !isRefetchingPreview && !zapPreviewQuery.isError && zapPreviewQuery.data ? (
                  <>
                    {/* Input token */}
                    <TokenInfoRow
                      symbol={zapInputToken === 'USDS' ? pool.currency0.symbol : pool.currency1.symbol}
                      icon={zapInputToken === 'USDS' ? token0Config?.icon : token1Config?.icon}
                      amount={zapInputAmount || '0'}
                      usdValue={usdValues?.[zapInputToken === 'USDS' ? 'TOKEN0' : 'TOKEN1'] || '0.00'}
                    />
                    {/* Swap info */}
                    <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Swap amount</span>
                        <span className="text-white">
                          {zapPreviewQuery.data.formatted.swapAmount} {zapInputToken}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Route</span>
                        <div className="flex items-center gap-1">
                          {/* Input token icon */}
                          {(zapInputToken === 'USDS' ? token0Config?.icon : token1Config?.icon) ? (
                            <Image
                              src={(zapInputToken === 'USDS' ? token0Config?.icon : token1Config?.icon)!}
                              alt={zapInputToken || ''}
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[8px] font-bold">
                              {zapInputToken?.charAt(0)}
                            </div>
                          )}
                          {/* Chevron */}
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                            <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                          </svg>
                          {/* Route label */}
                          <span className="text-xs text-muted-foreground">
                            {zapPreviewQuery.data.route.type === 'psm' ? 'PSM' : 'Unified Pool'}
                          </span>
                          {/* Chevron */}
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5">
                            <polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                          </svg>
                          {/* Output token icon */}
                          {(zapInputToken === 'USDS' ? token1Config?.icon : token0Config?.icon) ? (
                            <Image
                              src={(zapInputToken === 'USDS' ? token1Config?.icon : token0Config?.icon)!}
                              alt={zapInputToken === 'USDS' ? 'USDC' : 'USDS'}
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[8px] font-bold">
                              {zapInputToken === 'USDS' ? 'U' : 'U'}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Expected shares</span>
                        <span>
                          <span className="text-muted-foreground">
                            {parseFloat(zapPreviewQuery.data.formatted.expectedShares).toFixed(6)}
                          </span>
                          {zapPreviewQuery.data.shareValue && (
                            <span className="text-white ml-1">
                              (~${(parseFloat(zapPreviewQuery.data.shareValue.formatted0) + parseFloat(zapPreviewQuery.data.shareValue.formatted1)).toFixed(2)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                ) : !isZapMode && isUnifiedYield && depositPreview ? (
                  /* For balanced Unified Yield (NOT zap mode), use depositPreview amounts */
                  <>
                    {parseFloat(depositPreview.amount0Formatted) > 0 && (
                      <TokenInfoRow
                        symbol={pool.currency0.symbol}
                        icon={token0Config?.icon}
                        amount={depositPreview.amount0Formatted}
                        usdValue={usdValues?.TOKEN0 || '0.00'}
                      />
                    )}
                    {parseFloat(depositPreview.amount1Formatted) > 0 && (
                      <TokenInfoRow
                        symbol={pool.currency1.symbol}
                        icon={token1Config?.icon}
                        amount={depositPreview.amount1Formatted}
                        usdValue={usdValues?.TOKEN1 || '0.00'}
                      />
                    )}
                  </>
                ) : !isZapMode ? (
                  /* For V4 or fallback */
                  <>
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
                  </>
                ) : null /* Zap mode handled above */}
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
                  disabled={isCreateButtonDisabled}
                  className={cn(
                    "w-full h-12 text-base font-semibold",
                    isCreateButtonDisabled
                      ? "relative border border-sidebar-border bg-button text-white/75 !opacity-100"
                      : "bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
                  )}
                  style={isCreateButtonDisabled ? { backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  {isZapMode ? 'Zap & Create' : 'Create'}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
