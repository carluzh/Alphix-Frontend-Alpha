'use client';

import { useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';
import { reportError, reportMessage } from '@/lib/observability';
import { type Address } from 'viem';
import { clearCachedPermit } from '@/lib/permit-types';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { invalidateAfterTx } from '@/lib/apollo/mutations/invalidation';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import dynamic from 'next/dynamic';
import { getPoolBySlug, getAllTokens, getToken, resolveTokenIcon, type TokenSymbol } from '@/lib/pools-config';
import { PositionStatus } from '@/lib/uniswap/liquidity/pool-types';

const PositionRangeChart = dynamic(() => import('@/components/liquidity/PositionRangeChart/PositionRangeChart').then(mod => mod.PositionRangeChart), { ssr: false });
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';
import { chainIdForMode } from '@/lib/network-mode';
import { useChainMismatch } from '@/hooks/useChainMismatch';

import {
  buildLiquidityTxContext,
  generateLPTransactionSteps,
  type MintTxApiResponse,
} from '@/lib/liquidity/transaction';
import { collapseToBatchedAsync } from '@/lib/liquidity/transaction/steps/collapseBatchedSteps';
import { useCanBatchCalls } from '@/lib/transactions/useCanBatchCalls';
import {
  LiquidityTransactionType,
  type TransactionStep,
  type ValidatedLiquidityTxContext,
} from '@/lib/liquidity/types';

import { buildUnifiedYieldDepositTx, buildDepositParamsFromPreview } from '@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx';
import { buildApprovalRequests as buildApprovalRequestsUtil } from '@/lib/liquidity/hooks/approval';
import { toApproveRequest } from '@/lib/liquidity/utils/toApproveRequest';

import { TransactionModal } from '@/components/transactions/TransactionModal';
import { useLiquidityExecutors } from '@/lib/transactions/flows/useLiquidityExecutors';
import { mapExecutorStepsToUI } from './mapExecutorStepsToUI';
import { TokenInfoRow, DoubleCurrencyLogo } from './shared/ReviewComponents';
import type { StepGenerationResult } from '@/lib/transactions/useStepExecutor';
import type { TransactionStep as UITransactionStep } from '@/lib/transactions/types';

export function ReviewExecuteModal() {
  const router = useRouter();
  const { address } = useAccount();
  const { state, closeReviewModal, poolStateData, poolNetworkMode } = useAddLiquidityContext();
  const { ensureChain } = useChainMismatch();

  const networkMode = poolNetworkMode ?? 'base';
  const chainId = chainIdForMode(networkMode);
  const canBatchCalls = useCanBatchCalls(chainId);

  const {
    txInfo,
    calculatedData,
    usdValues,
    gasFeeEstimateUSD,
    depositPreview,
    isUnifiedYield,
    syncedAmounts,
    syncAmountsFromApi,
    clearSyncedAmounts,
    refetchUnifiedYieldApprovals,
  } = useCreatePositionTxContext();

  const pool = state.poolId ? getPoolBySlug(state.poolId, networkMode) : null;
  const tokens = getAllTokens(networkMode);
  const token0Config = pool ? tokens[pool.currency0.symbol] : null;
  const token1Config = pool ? tokens[pool.currency1.symbol] : null;
  const token0Icon = pool ? resolveTokenIcon(pool.currency0.symbol) : '/tokens/placeholder.svg';
  const token1Icon = pool ? resolveTokenIcon(pool.currency1.symbol) : '/tokens/placeholder.svg';

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

  const txContextRef = useRef<ValidatedLiquidityTxContext | null>(null);
  const liquidityExecutors = useLiquidityExecutors(txContextRef);

  const buildApprovalRequests = useCallback((params: {
    needsToken0: boolean;
    needsToken1: boolean;
    token0Address: Address;
    token1Address: Address;
    spender: Address;
    amount0: bigint;
    amount1: bigint;
  }) => buildApprovalRequestsUtil({ ...params, chainId: chainId! }), [chainId]);

  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
  try {
    if (!pool || !address || !chainId) throw new Error('Missing pool, address, or chainId');

    const token0Symbol = pool.currency0.symbol as TokenSymbol;
    const token1Symbol = pool.currency1.symbol as TokenSymbol;
    const token0 = getToken(token0Symbol, networkMode);
    const token1 = getToken(token1Symbol, networkMode);
    if (!token0 || !token1) throw new Error('Token configuration not found');

    if (isUnifiedYield && depositPreview && pool.hooks) {
      const hookAddress = pool.hooks as Address;
      const freshApprovals = await refetchUnifiedYieldApprovals();
      const approvals = buildApprovalRequests({
        needsToken0: freshApprovals?.token0NeedsApproval ?? false,
        needsToken1: freshApprovals?.token1NeedsApproval ?? false,
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
      const uyRawSteps = generateLPTransactionSteps(context as ValidatedLiquidityTxContext);
      if (uyRawSteps.length === 0) {
        throw new Error('Transaction context produced no executable steps. Refresh and try again.');
      }
      return { steps: canBatchCalls ? collapseToBatchedAsync(uyRawSteps as TransactionStep[]) : uyRawSteps };
    }

    if (isUnifiedYield) {
      throw new Error(depositPreview ? 'Pool hook address not configured' : 'Deposit preview not available');
    }

    const tl = calculatedData?.finalTickLower ?? txInfo?.tickLower ?? 0;
    const tu = calculatedData?.finalTickUpper ?? txInfo?.tickUpper ?? 0;
    let inputAmount = state.amount0 || state.amount1 || '0';
    let inputTokenSymbol = token0Symbol;
    if (state.inputSide === 'token0') { inputAmount = state.amount0 || '0'; inputTokenSymbol = token0Symbol; }
    else if (state.inputSide === 'token1') { inputAmount = state.amount1 || '0'; inputTokenSymbol = token1Symbol; }

    const response = await fetch('/api/liquidity/prepare-mint-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address, poolId: state.poolId, token0Symbol, token1Symbol,
        inputAmount, inputTokenSymbol,
        userTickLower: tl, userTickUpper: tu,
        chainId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to prepare transaction');
    }

    const apiResponse: MintTxApiResponse = await response.json();

    if (!apiResponse.details?.token0?.amount || !apiResponse.details?.token1?.amount) {
      throw new Error('Uniswap LP API response missing token amounts');
    }

    syncAmountsFromApi({
      TOKEN0: apiResponse.details.token0.amount,
      TOKEN1: apiResponse.details.token1.amount,
    }, { decimals0: token0.decimals, decimals1: token1.decimals });

    // If the backend returned a pre-built create tx alongside ERC20 approvals
    // (no-permit re-fetch case — existing Permit2 state still valid), treat it
    // as the tx source so the signed-flow generator produces [approve, sync_create].
    const normalizedApiResponse: MintTxApiResponse =
      apiResponse.needsApproval && (apiResponse as any).create
        ? ({ ...apiResponse, needsApproval: false } as MintTxApiResponse)
        : apiResponse;

    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Create,
      apiResponse: normalizedApiResponse,
      token0: { address: token0.address as Address, symbol: token0.symbol, decimals: token0.decimals, chainId },
      token1: { address: token1.address as Address, symbol: token1.symbol, decimals: token1.decimals, chainId },
      amount0: apiResponse.details.token0.amount,
      amount1: apiResponse.details.token1.amount,
      chainId,
      approveToken0Request: toApproveRequest(apiResponse.approveToken0Tx, chainId),
      approveToken1Request: toApproveRequest(apiResponse.approveToken1Tx, chainId),
      createPositionRequestArgs: {
        userAddress: address, poolId: state.poolId!, token0Symbol, token1Symbol,
        inputAmount, inputTokenSymbol,
        userTickLower: tl, userTickUpper: tu,
        chainId,
        permitBatchData: apiResponse.permitBatchData,
      },
    });

    txContextRef.current = context as ValidatedLiquidityTxContext;
    const v4RawSteps = generateLPTransactionSteps(context as ValidatedLiquidityTxContext);
    if (v4RawSteps.length === 0) {
      throw new Error('Transaction context produced no executable steps. Refresh and try again.');
    }
    return { steps: canBatchCalls ? collapseToBatchedAsync(v4RawSteps as TransactionStep[]) : v4RawSteps };
  } catch (err) {
    reportError(err, {
      domain: isUnifiedYield ? 'unified-yield' : 'liquidity',
      action: isUnifiedYield ? 'deposit' : 'mint',
      component: 'ReviewExecuteModal',
      networkMode,
      chainId,
      extras: { poolId: pool?.slug, userAddress: address, isUnifiedYield },
    });
    throw err;
  }
  }, [pool, address, chainId, networkMode, state, txInfo, calculatedData, isUnifiedYield, depositPreview, buildApprovalRequests, refetchUnifiedYieldApprovals, poolStateData, canBatchCalls, syncAmountsFromApi]);

  const mapStepsToUIFn = useCallback((steps: unknown[]): UITransactionStep[] => {
    return mapExecutorStepsToUI(steps as any, pool, token0Icon, token1Icon);
  }, [pool, token0Icon, token1Icon]);

  const onBeforeExecute = useCallback(async () => {
    clearSyncedAmounts();
    const ok = await ensureChain(chainId);
    return ok;
  }, [chainId, ensureChain, clearSyncedAmounts]);

  const handleSuccess = useCallback((results?: Map<number, { txHash?: string }>) => {
    if (address && chainId && pool) {
      clearCachedPermit(address, chainId, pool.currency0.symbol, pool.currency1.symbol);
    }

    let hash: string | undefined;
    if (results) {
      for (const [, result] of results) {
        if (result.txHash) hash = result.txHash;
      }
    }
    if (hash) {
      toast.success('Position created', {
        action: {
          label: 'View transaction',
          onClick: () => window.open(getExplorerTxUrl(hash!, networkMode), '_blank'),
        },
      });
    } else {
      toast.success('Position created');
    }

    closeReviewModal();
    // Kick off Apollo refetch BEFORE navigation so Overview mounts with fresh user-positions.
    // invalidateAfterTx implements Uniswap's 2-layer pattern (3s delayed refetchQueries({include:'active'})).
    if (address && chainId) {
      invalidateAfterTx({ owner: address, chainId }).catch((err) =>
        reportMessage('post-tx refetch failed', {
          domain: 'liquidity',
          action: 'refetchPositions',
          level: 'warning',
          component: 'ReviewExecuteModal',
          chainId,
          extras: { refetchError: err instanceof Error ? err.message : String(err) },
        }),
      );
    }
    router.push('/overview');
  }, [closeReviewModal, router, address, chainId, pool, networkMode]);

  const isConfirmDisabled = isUnifiedYield && !depositPreview;

  if (!pool) return null;

  const displayAmount0 = syncedAmounts?.TOKEN0 ?? state.amount0;
  const displayAmount1 = syncedAmounts?.TOKEN1 ?? state.amount1;

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
      confirmText="Create"
      confirmDisabled={isConfirmDisabled}
      generateSteps={generateSteps}
      executors={liquidityExecutors}
      mapStepsToUI={mapStepsToUIFn}
      onBeforeExecute={onBeforeExecute}
      onSuccess={handleSuccess}
      renderFooterExtra={gasFooter}
    >
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

      {pool.poolId && (
        <div className="mt-4">
          <PositionRangeChart
            poolId={pool.poolId}
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

      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">Depositing</span>
        </div>
        <div className="flex flex-col gap-4">
          {isUnifiedYield && depositPreview ? (
            <>
              {parseFloat(depositPreview.amount0Formatted) > 0 && (
                <TokenInfoRow symbol={pool.currency0.symbol} icon={token0Icon} amount={depositPreview.amount0Formatted} usdValue={usdValues?.TOKEN0 || '0.00'} />
              )}
              {parseFloat(depositPreview.amount1Formatted) > 0 && (
                <TokenInfoRow symbol={pool.currency1.symbol} icon={token1Icon} amount={depositPreview.amount1Formatted} usdValue={usdValues?.TOKEN1 || '0.00'} />
              )}
            </>
          ) : (
            <>
              {displayAmount0 && parseFloat(displayAmount0) > 0 && (
                <TokenInfoRow symbol={pool.currency0.symbol} icon={token0Icon} amount={displayAmount0} usdValue={usdValues?.TOKEN0 || '0.00'} />
              )}
              {displayAmount1 && parseFloat(displayAmount1) > 0 && (
                <TokenInfoRow symbol={pool.currency1.symbol} icon={token1Icon} amount={displayAmount1} usdValue={usdValues?.TOKEN1 || '0.00'} />
              )}
            </>
          )}
        </div>
      </div>
    </TransactionModal>
  );
}
