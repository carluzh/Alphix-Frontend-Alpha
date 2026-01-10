'use client';

/**
 * ReviewExecuteModal - Modal for reviewing and executing liquidity position
 * Follows Uniswap pattern where review content stays visible during transaction
 * Errors are shown inline (not in a separate view) like Uniswap's ErrorCallout
 * On success: closes modal and navigates to /overview (Uniswap pattern)
 *
 * @see interface/apps/web/src/components/Liquidity/ReviewModal.tsx
 * @see interface/apps/web/src/pages/CreatePosition/CreatePositionModal.tsx (onSuccess pattern)
 *
 * States:
 * - review: Shows position summary with Confirm button
 * - executing: Review content visible, bottom shows ProgressIndicator
 */

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { IconXmark } from 'nucleo-micro-bold-essential';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import { getPoolById, getAllTokens, type TokenSymbol } from '@/lib/pools-config';
import { useAddLiquidityTransaction } from '@/lib/liquidity/hooks/transaction/useAddLiquidityTransaction';
import { PositionRangeChart } from '@/components/liquidity/PositionRangeChart/PositionRangeChart';
import { PositionStatus } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb';
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';
import { useNetwork } from '@/lib/network-context';

// New Uniswap-style transaction progress components
import { ProgressIndicator } from '@/components/transactions';
import {
  buildAddLiquiditySteps,
  TransactionStep,
  CurrentStepState,
} from '@/lib/transactions';


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
function ErrorCallout({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={onRetry}
          className="text-xs text-red-400 hover:text-red-300 underline mt-1"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function ReviewExecuteModal() {
  const router = useRouter();
  const { chainId } = useNetwork();
  const { state, closeReviewModal, reset, poolStateData } = useAddLiquidityContext();

  // Get transaction data from TxContext
  const {
    txInfo,
    calculatedData,
    usdValues,
  } = useCreatePositionTxContext();

  // Refunded amounts (populated during migrations or when position manager returns excess)
  // Currently unused for standard add liquidity, but ready for migration flow
  const refundedAmounts = useMemo(() => {
    // TODO: Populate from migration transaction result when migration is implemented
    // Refunds occur when the mint/increase returns more tokens than expected
    return { token0: null as string | null, token1: null as string | null };
  }, []);

  // Modal state
  const [view, setView] = useState<ModalView>('review');
  const [currentStep, setCurrentStep] = useState<CurrentStepState | undefined>(undefined);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get pool and token info
  const pool = state.poolId ? getPoolById(state.poolId) : null;
  const tokens = getAllTokens();
  const token0Config = pool ? tokens[pool.currency0.symbol] : null;
  const token1Config = pool ? tokens[pool.currency1.symbol] : null;

  // Transaction hook for real execution
  const {
    handleApprove,
    handleDeposit,
    handleZapSwapAndDeposit,
    isWorking,
    isDepositSuccess,
    refetchApprovals,
  } = useAddLiquidityTransaction({
    token0Symbol: (pool?.currency0.symbol || 'aUSDC') as TokenSymbol,
    token1Symbol: (pool?.currency1.symbol || 'aUSDT') as TokenSymbol,
    amount0: state.amount0 || '0',
    amount1: state.amount1 || '0',
    tickLower: (txInfo?.tickLower ?? state.tickLower ?? 0).toString(),
    tickUpper: (txInfo?.tickUpper ?? state.tickUpper ?? 0).toString(),
    activeInputSide: state.inputSide === 'token0' ? 'amount0' : state.inputSide === 'token1' ? 'amount1' : null,
    calculatedData,
    onLiquidityAdded: () => {
      // Uniswap pattern: clear steps, close modal, navigate
      setCurrentStep(undefined);
      closeReviewModal();
      reset();
      router.push('/overview');
    },
    onOpenChange: (isOpen) => {
      if (!isOpen) closeReviewModal();
    },
    isZapMode: state.isZapMode,
    zapInputToken: state.inputSide === 'token0' ? 'token0' : 'token1',
  });

  // Build transaction steps using Uniswap pattern
  const steps: TransactionStep[] = useMemo(() => {
    if (!pool) return [];

    return buildAddLiquiditySteps({
      needsToken0Approval: txInfo?.needsToken0Approval ?? false,
      needsToken1Approval: txInfo?.needsToken1Approval ?? false,
      isZapMode: state.isZapMode ?? false,
      token0Symbol: pool.currency0.symbol,
      token1Symbol: pool.currency1.symbol,
      token0Address: pool.currency0.address,
      token1Address: pool.currency1.address,
      token0Icon: token0Config?.icon,
      token1Icon: token1Config?.icon,
    });
  }, [pool, state.isZapMode, txInfo, token0Config, token1Config]);

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

  // Handle confirm - start execution with real transaction flow
  const handleConfirm = async () => {
    if (!pool || steps.length === 0) return;

    setView('executing');
    setIsExecuting(true);
    setError(null);

    // Start with first step active
    setCurrentStep({ step: steps[0], accepted: false });

    try {
      let stepIdx = 0;

      // Step 1: Approve token0 if needed
      if (txInfo?.needsToken0Approval) {
        setCurrentStep({ step: steps[stepIdx], accepted: false });
        // Mark as in-progress when wallet action is sent
        setCurrentStep({ step: steps[stepIdx], accepted: true });
        await handleApprove(pool.currency0.symbol as TokenSymbol, state.amount0);
        await refetchApprovals();
        stepIdx++;
      }

      // Step 2: Approve token1 if needed (not in zap mode)
      if (txInfo?.needsToken1Approval && !state.isZapMode) {
        setCurrentStep({ step: steps[stepIdx], accepted: false });
        setCurrentStep({ step: steps[stepIdx], accepted: true });
        await handleApprove(pool.currency1.symbol as TokenSymbol, state.amount1);
        await refetchApprovals();
        stepIdx++;
      }

      // Step 3: Permit signing
      setCurrentStep({ step: steps[stepIdx], accepted: false });
      setCurrentStep({ step: steps[stepIdx], accepted: true });
      stepIdx++;

      // Step 4: Execute transaction
      setCurrentStep({ step: steps[stepIdx], accepted: false });
      setCurrentStep({ step: steps[stepIdx], accepted: true });

      if (state.isZapMode) {
        await handleZapSwapAndDeposit();
      } else {
        await handleDeposit();
      }

      // Success is handled by onLiquidityAdded callback which sets view to 'success'
    } catch (err) {
      console.error('[ReviewExecuteModal] Transaction error:', err);

      // Check for user rejection
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      const isUserRejection =
        errorMessage.toLowerCase().includes('user rejected') ||
        errorMessage.toLowerCase().includes('user denied');

      // Go back to review - errors shown inline (Uniswap pattern)
      setView('review');
      setCurrentStep(undefined);

      // Only show error callout for non-rejection errors
      if (!isUserRejection) {
        setError(errorMessage);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // Clear error and retry
  const handleRetry = () => {
    setError(null);
  };

  // Handle close
  const handleClose = () => {
    if (!isExecuting) {
      closeReviewModal();
    }
  };

  // Reset state when modal opens
  useEffect(() => {
    if (state.isReviewModalOpen) {
      setView('review');
      setCurrentStep(undefined);
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
                {!state.isZapMode && state.amount1 && parseFloat(state.amount1) > 0 && (
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
                <ErrorCallout error={error} onRetry={handleRetry} />
              </div>
            )}

            {/* Bottom Section: Button OR Progress Indicator */}
            <div className="p-4 pt-2">
              {view === 'executing' && currentStep && steps.length > 0 ? (
                <ProgressIndicator steps={steps} currentStep={currentStep} />
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
