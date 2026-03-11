'use client';

/**
 * ReviewExecuteModal - Uses shared TransactionModal
 *
 * Reads from AddLiquidityContext + CreatePositionTxContext (wizard contexts).
 * Review content (chart, prices, token amounts, zap preview) rendered as
 * TransactionModal children. All execution logic delegated to TransactionModal
 * + useLiquidityExecutors.
 *
 * Supports V4 Custom, Unified Yield (balanced), and Zap deposit modes.
 *
 * @see components/transactions/TransactionModal.tsx
 * @see lib/transactions/flows/useLiquidityExecutors.ts
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TokenImage } from '@/components/ui/token-image';
import { useAccount, usePublicClient } from 'wagmi';
import { AlertCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { parseUnits, type Address } from 'viem';
import { clearCachedPermit } from '@/lib/permit-types';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import dynamic from 'next/dynamic';
import { getPoolById, getAllTokens, getToken, resolveTokenIcon, type TokenSymbol } from '@/lib/pools-config';
import { PositionStatus } from '@/lib/uniswap/liquidity/pool-types';

const PositionRangeChart = dynamic(() => import('@/components/liquidity/PositionRangeChart/PositionRangeChart').then(mod => mod.PositionRangeChart), { ssr: false });
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';
import { chainIdForMode } from '@/lib/network-mode';
import { useChainMismatch } from '@/hooks/useChainMismatch';
import { getStoredUserSettings } from '@/hooks/useUserSettings';

import {
  buildLiquidityTxContext,
  generateLPTransactionSteps,
  type MintTxApiResponse,
} from '@/lib/liquidity/transaction';
import {
  LiquidityTransactionType,
  type ValidatedLiquidityTxContext,
} from '@/lib/liquidity/types';

import { buildUnifiedYieldDepositTx, buildDepositParamsFromPreview } from '@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx';
import { buildApprovalRequests as buildApprovalRequestsUtil } from '@/lib/liquidity/hooks/approval';

// Zap support
import { useZapPreview, useZapApprovals, generateZapSteps, isPreviewFresh, isZapEligiblePool, type ZapToken } from '@/lib/liquidity/zap';
import { getZapPoolConfig } from '@/lib/liquidity/zap/constants';
import { isNativeToken } from '@/lib/aggregators/types';

// TransactionModal + executors
import { TransactionModal } from '@/components/transactions/TransactionModal';
import { useLiquidityExecutors } from '@/lib/transactions/flows/useLiquidityExecutors';
import { mapExecutorStepsToUI } from './mapExecutorStepsToUI';
import { TokenInfoRow, DoubleCurrencyLogo } from './shared/ReviewComponents';
import type { StepGenerationResult } from '@/lib/transactions/useStepExecutor';
import type { TransactionStep as UITransactionStep } from '@/lib/transactions/types';

// ERC20 balanceOf ABI for zap dust tracking
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// =============================================================================
// COMPONENT
// =============================================================================

export function ReviewExecuteModal() {
  const router = useRouter();
  const { address } = useAccount();
  const { state, closeReviewModal, poolStateData, poolNetworkMode } = useAddLiquidityContext();
  const { ensureChain } = useChainMismatch();

  const networkMode = poolNetworkMode ?? 'base';
  const chainId = chainIdForMode(networkMode);
  const publicClient = usePublicClient({ chainId });

  const {
    txInfo,
    calculatedData,
    usdValues,
    gasFeeEstimateUSD,
    depositPreview,
    isUnifiedYield,
    refetchApprovals,
  } = useCreatePositionTxContext();

  // Pool and token info
  const pool = state.poolId ? getPoolById(state.poolId, networkMode) : null;
  const tokens = getAllTokens(networkMode);
  const token0Config = pool ? tokens[pool.currency0.symbol] : null;
  const token1Config = pool ? tokens[pool.currency1.symbol] : null;
  const token0Icon = pool ? resolveTokenIcon(pool.currency0.symbol) : '/tokens/placeholder.svg';
  const token1Icon = pool ? resolveTokenIcon(pool.currency1.symbol) : '/tokens/placeholder.svg';

  // ─── Zap mode detection ────────────────────────────────────────────────
  const isZapMode = isUnifiedYield && isZapEligiblePool(state.poolId) && state.depositMode === 'zap' && state.zapInputToken !== null;
  const zapInputToken: ZapToken | undefined = isZapMode
    ? (state.zapInputToken === 'token0' ? pool?.currency0.symbol as ZapToken : pool?.currency1.symbol as ZapToken)
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
    refetchEnabled: true,
    networkMode,
  });

  // Zap countdown
  const [zapRefetchCountdown, setZapRefetchCountdown] = useState(10);
  useEffect(() => {
    if (!isZapMode || zapPreviewQuery.isLoading || zapPreviewQuery.isFetching) return;
    const updateCountdown = () => {
      const elapsed = Date.now() - (zapPreviewQuery.dataUpdatedAt || Date.now());
      const remaining = Math.max(0, Math.ceil((10000 - elapsed) / 1000));
      setZapRefetchCountdown(remaining);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isZapMode, zapPreviewQuery.dataUpdatedAt, zapPreviewQuery.isLoading, zapPreviewQuery.isFetching]);

  // Zap approvals
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
    networkMode,
  });

  // ─── Price range display ───────────────────────────────────────────────
  const rehypoTickLower = pool?.rehypoRange?.min ? parseInt(pool.rehypoRange.min, 10) : null;
  const rehypoTickUpper = pool?.rehypoRange?.max ? parseInt(pool.rehypoRange.max, 10) : null;
  const tickLower = isUnifiedYield && rehypoTickLower !== null
    ? rehypoTickLower
    : (txInfo?.tickLower ?? state.tickLower ?? 0);
  const tickUpper = isUnifiedYield && rehypoTickUpper !== null
    ? rehypoTickUpper
    : (txInfo?.tickUpper ?? state.tickUpper ?? 0);

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

  const { minPrice, maxPrice, isFullRange: isFullRangeFromHook } = useGetRangeDisplay({
    priceOrdering,
    pricesInverted: false,
    tickSpacing: pool?.tickSpacing,
    tickLower,
    tickUpper,
  });

  const formattedPrices = useMemo(() => {
    if (isFullRangeFromHook || state.isFullRange || (state.mode === 'rehypo' && pool?.rehypoRange?.isFullRange)) {
      return { min: '0', max: '∞' };
    }
    return { min: minPrice || '-', max: maxPrice || '-' };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange?.isFullRange]);

  const chartPrices = useMemo(() => {
    if (isFullRangeFromHook || state.isFullRange || (state.mode === 'rehypo' && pool?.rehypoRange?.isFullRange)) {
      return { priceLower: 0, priceUpper: Number.MAX_SAFE_INTEGER };
    }
    const priceLower = minPrice && minPrice !== '-' && minPrice !== '∞'
      ? parseFloat(minPrice.replace(/,/g, ''))
      : undefined;
    const priceUpper = maxPrice && maxPrice !== '-' && maxPrice !== '∞'
      ? parseFloat(maxPrice.replace(/,/g, ''))
      : undefined;
    return { priceLower, priceUpper };
  }, [minPrice, maxPrice, isFullRangeFromHook, state.isFullRange, state.mode, pool?.rehypoRange?.isFullRange]);

  const chartPositionStatus = useMemo(() => {
    const currentTick = poolStateData?.currentPoolTick;
    if (currentTick === null || currentTick === undefined) return PositionStatus.IN_RANGE;
    if (currentTick >= tickLower && currentTick <= tickUpper) return PositionStatus.IN_RANGE;
    return PositionStatus.OUT_OF_RANGE;
  }, [poolStateData?.currentPoolTick, tickLower, tickUpper]);

  // ─── Executors ─────────────────────────────────────────────────────────
  const txContextRef = useRef<ValidatedLiquidityTxContext | null>(null);
  const liquidityExecutors = useLiquidityExecutors(txContextRef);

  // Wrapper for shared approval utility
  const buildApprovalRequests = useCallback((params: {
    needsToken0: boolean;
    needsToken1: boolean;
    token0Address: Address;
    token1Address: Address;
    spender: Address;
    amount0: bigint;
    amount1: bigint;
  }) => buildApprovalRequestsUtil({ ...params, chainId: chainId! }), [chainId]);

  // ─── Generate steps ────────────────────────────────────────────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
  try {
    if (!pool || !address || !chainId) throw new Error('Missing pool, address, or chainId');

    const token0Symbol = pool.currency0.symbol as TokenSymbol;
    const token1Symbol = pool.currency1.symbol as TokenSymbol;
    const token0 = getToken(token0Symbol, networkMode);
    const token1 = getToken(token1Symbol, networkMode);
    if (!token0 || !token1) throw new Error('Token configuration not found');

    // ═══ ZAP MODE ═══
    if (isZapMode && zapPreviewQuery.data && zapApprovalsQuery.approvals) {
      const hookAddress = pool.hooks as Address;
      let preview = zapPreviewQuery.data;

      if (!isPreviewFresh(preview)) {
        const freshPreview = await zapPreviewQuery.refetch();
        if (!freshPreview.data) throw new Error('Failed to refresh zap preview');
        preview = freshPreview.data;
      }

      const userSettings = getStoredUserSettings();
      const inputToken = preview.inputTokenInfo.symbol as ZapToken;
      const isInputToken0 = inputToken === pool.currency0.symbol;
      const token0Amount = isInputToken0 ? preview.remainingInputAmount : preview.swapOutputAmount;
      const token1Amount = isInputToken0 ? preview.swapOutputAmount : preview.remainingInputAmount;
      const sharesWithHaircut = (preview.expectedShares * 999n) / 1000n;

      // Query initial balances for dust tracking
      let initialBalance0: bigint | undefined;
      let initialBalance1: bigint | undefined;
      const isToken0Native = isNativeToken(pool.currency0.address);
      const isToken1Native = isNativeToken(pool.currency1.address);
      if (publicClient) {
        try {
          const [balance0, balance1] = await Promise.all([
            isToken0Native
              ? publicClient.getBalance({ address, blockTag: 'latest' })
              : publicClient.readContract({ address: pool.currency0.address as Address, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address], blockTag: 'latest' }) as Promise<bigint>,
            isToken1Native
              ? publicClient.getBalance({ address, blockTag: 'latest' })
              : publicClient.readContract({ address: pool.currency1.address as Address, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address], blockTag: 'latest' }) as Promise<bigint>,
          ]);
          initialBalance0 = balance0;
          initialBalance1 = balance1;
        } catch (e) {
          console.warn('[ReviewExecuteModal] Failed to query initial balances:', e);
        }
      }

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
        poolConfig: getZapPoolConfig(state.poolId!) ?? undefined,
        targetChainId: chainId,
      });

      txContextRef.current = { chainId } as any;
      return { steps: zapStepsResult.steps };
    }

    // ═══ UNIFIED YIELD (balanced) ═══
    if (isUnifiedYield && depositPreview && pool.hooks) {
      const hookAddress = pool.hooks as Address;
      const freshApprovals = await refetchApprovals();
      const approvals = buildApprovalRequests({
        needsToken0: freshApprovals.needsToken0ERC20Approval,
        needsToken1: freshApprovals.needsToken1ERC20Approval,
        token0Address: token0.address as Address,
        token1Address: token1.address as Address,
        spender: hookAddress,
        amount0: depositPreview.amount0,
        amount1: depositPreview.amount1,
      });

      const sqrtPriceX96 = poolStateData?.sqrtPriceX96 ? BigInt(poolStateData.sqrtPriceX96) : undefined;
      const depositParams = buildDepositParamsFromPreview(
        depositPreview, hookAddress, token0.address as Address, token1.address as Address,
        address, state.poolId!, chainId, sqrtPriceX96, 500,
      );
      const depositTx = buildUnifiedYieldDepositTx(depositParams);

      const context = buildLiquidityTxContext({
        type: LiquidityTransactionType.Create,
        apiResponse: {
          needsApproval: false,
          create: { to: depositTx.to, data: depositTx.calldata, value: depositTx.value?.toString() || '0', gasLimit: depositTx.gasLimit?.toString(), chainId },
          sqrtRatioX96: undefined,
        } as MintTxApiResponse,
        token0: { address: token0.address as Address, symbol: token0.symbol, decimals: token0.decimals, chainId },
        token1: { address: token1.address as Address, symbol: token1.symbol, decimals: token1.decimals, chainId },
        amount0: depositPreview.amount0.toString(),
        amount1: depositPreview.amount1.toString(),
        chainId,
        approveToken0Request: approvals.token0,
        approveToken1Request: approvals.token1,
        isUnifiedYield: true,
        hookAddress,
        poolId: state.poolId!,
        sharesToMint: depositPreview.shares,
      });

      txContextRef.current = context as ValidatedLiquidityTxContext;
      return { steps: generateLPTransactionSteps(context as ValidatedLiquidityTxContext) };
    }

    // ═══ V4 CUSTOM ═══
    if (isUnifiedYield) {
      throw new Error(depositPreview ? 'Pool hook address not configured' : 'Deposit preview not available');
    }

    const tl = calculatedData?.finalTickLower ?? txInfo?.tickLower ?? 0;
    const tu = calculatedData?.finalTickUpper ?? txInfo?.tickUpper ?? 0;
    let inputAmount = state.amount0 || state.amount1 || '0';
    let inputTokenSymbol = token0Symbol;
    if (state.inputSide === 'token0') { inputAmount = state.amount0 || '0'; inputTokenSymbol = token0Symbol; }
    else if (state.inputSide === 'token1') { inputAmount = state.amount1 || '0'; inputTokenSymbol = token1Symbol; }

    const userSettings = getStoredUserSettings();
    const slippageBps = Math.round(userSettings.slippage * 100);
    const deadlineMinutes = userSettings.deadline;

    const response = await fetch('/api/liquidity/prepare-mint-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address, token0Symbol, token1Symbol,
        inputAmount, inputTokenSymbol,
        userTickLower: tl, userTickUpper: tu,
        chainId, slippageBps, deadlineMinutes,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to prepare transaction');
    }

    const apiResponse: MintTxApiResponse = await response.json();

    const getRawAmount0 = (): string => {
      if (apiResponse.details?.token0.amount) return apiResponse.details.token0.amount;
      try { return parseUnits(state.amount0 || '0', token0.decimals).toString(); } catch { return '0'; }
    };
    const getRawAmount1 = (): string => {
      if (apiResponse.details?.token1.amount) return apiResponse.details.token1.amount;
      try { return parseUnits(state.amount1 || '0', token1.decimals).toString(); } catch { return '0'; }
    };

    const needsToken0 = apiResponse.needsToken0Approval ??
      (apiResponse.approvalTokenAddress?.toLowerCase() === token0.address.toLowerCase());
    const needsToken1 = apiResponse.needsToken1Approval ??
      (apiResponse.approvalTokenAddress?.toLowerCase() === token1.address.toLowerCase());

    const v4Approvals = apiResponse.erc20ApprovalNeeded && apiResponse.approveToAddress
      ? buildApprovalRequests({
          needsToken0, needsToken1,
          token0Address: token0.address as Address, token1Address: token1.address as Address,
          spender: apiResponse.approveToAddress as Address,
          amount0: BigInt(getRawAmount0()), amount1: BigInt(getRawAmount1()),
        })
      : {};

    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Create,
      apiResponse,
      token0: { address: token0.address as Address, symbol: token0.symbol, decimals: token0.decimals, chainId },
      token1: { address: token1.address as Address, symbol: token1.symbol, decimals: token1.decimals, chainId },
      amount0: getRawAmount0(),
      amount1: getRawAmount1(),
      chainId,
      approveToken0Request: v4Approvals.token0,
      approveToken1Request: v4Approvals.token1,
      createPositionRequestArgs: {
        userAddress: address, token0Symbol, token1Symbol,
        inputAmount, inputTokenSymbol,
        userTickLower: tl, userTickUpper: tu,
        chainId, slippageBps, deadlineMinutes,
        permitBatchData: apiResponse.permitBatchData,
      },
    });

    txContextRef.current = context as ValidatedLiquidityTxContext;
    return { steps: generateLPTransactionSteps(context as ValidatedLiquidityTxContext) };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: 'ReviewExecuteModal', operation: isZapMode ? 'zapTransaction' : 'transaction' },
      extra: { poolId: pool?.id, userAddress: address, chainId, isZapMode, isUnifiedYield },
    });
    throw err;
  }
  }, [pool, address, chainId, networkMode, state, txInfo, calculatedData, isUnifiedYield, depositPreview, isZapMode, zapPreviewQuery, zapApprovalsQuery, buildApprovalRequests, refetchApprovals, poolStateData, publicClient]);

  // ─── Map steps to UI ──────────────────────────────────────────────────
  const mapStepsToUIFn = useCallback((steps: unknown[]): UITransactionStep[] => {
    return mapExecutorStepsToUI(steps as any, pool, token0Icon, token1Icon);
  }, [pool, token0Icon, token1Icon]);

  // ─── Before execute: ensure chain ─────────────────────────────────────
  const onBeforeExecute = useCallback(async () => {
    const ok = await ensureChain(chainId);
    return ok;
  }, [chainId, ensureChain]);

  // ─── Success handler ──────────────────────────────────────────────────
  const handleSuccess = useCallback(() => {
    // Clean up cached permits
    if (address && chainId && pool) {
      clearCachedPermit(address, chainId, pool.currency0.symbol, pool.currency1.symbol);
    }
    closeReviewModal();
    router.push('/overview');
  }, [closeReviewModal, router, address, chainId, pool]);

  // ─── Button state ─────────────────────────────────────────────────────
  const isConfirmDisabled = isZapMode
    ? !zapPreviewQuery.data || !zapApprovalsQuery.approvals || zapPreviewQuery.isLoading || zapPreviewQuery.isFetching
    : isUnifiedYield && !depositPreview;

  if (!pool) return null;

  // ─── Gas fee footer ───────────────────────────────────────────────────
  const gasFooter = gasFeeEstimateUSD ? (
    <>
      <div className="border-t border-sidebar-border" />
      <div className="flex items-center justify-between py-3">
        <span className="text-sm text-muted-foreground">Network cost</span>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-sm bg-blue-500 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z" fill="white"/>
            </svg>
          </div>
          <span className="text-sm text-white">{gasFeeEstimateUSD}</span>
        </div>
      </div>
    </>
  ) : null;

  return (
    <TransactionModal
      open={state.isReviewModalOpen}
      onClose={closeReviewModal}
      title={isUnifiedYield ? 'Unified Yield Deposit' : 'Add liquidity'}
      confirmText={isZapMode ? 'Zap & Create' : 'Create'}
      confirmDisabled={isConfirmDisabled}
      generateSteps={generateSteps}
      executors={liquidityExecutors}
      mapStepsToUI={mapStepsToUIFn}
      onBeforeExecute={onBeforeExecute}
      onSuccess={handleSuccess}
      renderFooterExtra={gasFooter}
    >
      {/* Token Pair Section */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-white">{pool.currency0.symbol}</span>
            <span className="text-2xl font-semibold text-muted-foreground">/</span>
            <span className="text-2xl font-semibold text-white">{pool.currency1.symbol}</span>
          </div>
          <div className="flex items-center gap-2">
            {state.mode === 'rehypo' ? (
              <span className="text-xs font-medium px-2.5 py-1 rounded-lg border border-transparent" style={{ backgroundColor: 'rgba(152, 150, 255, 0.10)', color: '#9896FF' }}>
                Unified Yield
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-muted-foreground">Custom</span>
            )}
          </div>
        </div>
        <DoubleCurrencyLogo icon0={token0Icon} icon1={token1Icon} symbol0={pool.currency0.symbol} symbol1={pool.currency1.symbol} />
      </div>

      {/* Chart */}
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
            networkModeOverride={networkMode}
          />
        </div>
      )}

      {/* Min / Max prices */}
      <div className="flex mt-3 gap-4">
        <div className="flex-1">
          <span className="text-xs text-muted-foreground">Min</span>
          <p className="text-sm text-white">{formattedPrices.min} {pool.currency1.symbol} per {pool.currency0.symbol}</p>
        </div>
        <div className="flex-1">
          <span className="text-xs text-muted-foreground">Max</span>
          <p className="text-sm text-white">{formattedPrices.max} {pool.currency1.symbol} per {pool.currency0.symbol}</p>
        </div>
      </div>

      {/* Depositing Section */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{isZapMode ? 'Zap Deposit' : 'Depositing'}</span>
          {isZapMode && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              zapPreviewQuery.isLoading || zapPreviewQuery.isFetching
                ? 'bg-muted/50 text-muted-foreground animate-pulse'
                : 'bg-muted/30 text-muted-foreground/80'
            }`}>
              {zapPreviewQuery.isLoading || zapPreviewQuery.isFetching ? 'Calculating...' : `Refetches in ${zapRefetchCountdown}s`}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {/* Zap loading */}
          {isZapMode && (zapPreviewQuery.isLoading || zapPreviewQuery.isFetching) && (
            <>
              <TokenInfoRow
                symbol={state.zapInputToken === 'token0' ? pool.currency0.symbol : pool.currency1.symbol}
                icon={state.zapInputToken === 'token0' ? token0Icon : token1Icon}
                amount={zapInputAmount || '0'}
                usdValue={usdValues?.[state.zapInputToken === 'token0' ? 'TOKEN0' : 'TOKEN1'] || '0.00'}
              />
              <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Swap amount</span><div className="h-4 w-24 bg-muted/40 rounded animate-pulse" /></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Route</span><div className="h-4 w-28 bg-muted/40 rounded animate-pulse" /></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Expected shares</span><div className="h-4 w-32 bg-muted/40 rounded animate-pulse" /></div>
              </div>
            </>
          )}
          {/* Zap error */}
          {isZapMode && zapPreviewQuery.isError && !zapPreviewQuery.isFetching && (
            <div className="flex flex-row items-center gap-3 rounded-lg border p-3" style={{ backgroundColor: 'rgba(255, 89, 60, 0.08)', borderColor: 'rgba(255, 89, 60, 0.2)' }}>
              <div className="flex items-center justify-center p-2 rounded-md shrink-0" style={{ backgroundColor: 'rgba(255, 89, 60, 0.12)' }}>
                <AlertCircle className="w-4 h-4" style={{ color: '#FF593C' }} />
              </div>
              <span className="text-sm font-medium min-w-0 break-words" style={{ color: '#FF593C' }}>
                {zapPreviewQuery.error?.message || 'Failed to calculate zap preview'}
              </span>
            </div>
          )}
          {/* Zap preview data */}
          {isZapMode && !zapPreviewQuery.isLoading && !zapPreviewQuery.isFetching && !zapPreviewQuery.isError && zapPreviewQuery.data ? (
            <>
              <TokenInfoRow
                symbol={state.zapInputToken === 'token0' ? pool.currency0.symbol : pool.currency1.symbol}
                icon={state.zapInputToken === 'token0' ? token0Icon : token1Icon}
                amount={zapInputAmount || '0'}
                usdValue={usdValues?.[state.zapInputToken === 'token0' ? 'TOKEN0' : 'TOKEN1'] || '0.00'}
              />
              <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Swap amount</span>
                  <span className="text-white">{zapPreviewQuery.data.formatted.swapAmount} {zapInputToken}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Route</span>
                  <div className="flex items-center gap-1">
                    <TokenImage src={state.zapInputToken === 'token0' ? token0Icon : token1Icon} alt={zapInputToken || ''} size={16} />
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5"><polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                    <span className="text-xs text-muted-foreground">
                      {zapPreviewQuery.data.route.type === 'psm' ? 'PSM' : zapPreviewQuery.data.route.type === 'kyberswap' ? 'Kyberswap' : 'Unified Pool'}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 12 12" className="-mx-0.5"><polyline points="4 8 7 6 4 4" fill="none" stroke="#71717A" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
                    <TokenImage src={state.zapInputToken === 'token0' ? token1Icon : token0Icon} alt={state.zapInputToken === 'token0' ? pool.currency1.symbol : pool.currency0.symbol} size={16} />
                  </div>
                </div>
                {zapPreviewQuery.data.route.priceImpact >= 3 && (
                  <div className={`flex items-center gap-1.5 text-xs ${zapPreviewQuery.data.route.priceImpact >= 5 ? 'text-red-400' : 'text-yellow-400'}`}>
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {zapPreviewQuery.data.route.priceImpact >= 5 ? 'Very high' : 'High'} price impact ({zapPreviewQuery.data.route.priceImpact.toFixed(2)}%)
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expected shares</span>
                  <span>
                    <span className="text-muted-foreground">{parseFloat(zapPreviewQuery.data.formatted.expectedShares).toFixed(6)}</span>
                    {zapPreviewQuery.data.shareValue && (
                      <span className="text-white ml-1">(~${(parseFloat(zapPreviewQuery.data.shareValue.formatted0) + parseFloat(zapPreviewQuery.data.shareValue.formatted1)).toFixed(2)})</span>
                    )}
                  </span>
                </div>
              </div>
            </>
          ) : !isZapMode && isUnifiedYield && depositPreview ? (
            <>
              {parseFloat(depositPreview.amount0Formatted) > 0 && (
                <TokenInfoRow symbol={pool.currency0.symbol} icon={token0Icon} amount={depositPreview.amount0Formatted} usdValue={usdValues?.TOKEN0 || '0.00'} />
              )}
              {parseFloat(depositPreview.amount1Formatted) > 0 && (
                <TokenInfoRow symbol={pool.currency1.symbol} icon={token1Icon} amount={depositPreview.amount1Formatted} usdValue={usdValues?.TOKEN1 || '0.00'} />
              )}
            </>
          ) : !isZapMode ? (
            <>
              {state.amount0 && parseFloat(state.amount0) > 0 && (
                <TokenInfoRow symbol={pool.currency0.symbol} icon={token0Icon} amount={state.amount0} usdValue={usdValues?.TOKEN0 || '0.00'} />
              )}
              {state.amount1 && parseFloat(state.amount1) > 0 && (
                <TokenInfoRow symbol={pool.currency1.symbol} icon={token1Icon} amount={state.amount1} usdValue={usdValues?.TOKEN1 || '0.00'} />
              )}
            </>
          ) : null}
        </div>
      </div>
    </TransactionModal>
  );
}
