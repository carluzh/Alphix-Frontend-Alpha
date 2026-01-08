'use client';

/**
 * ReviewExecuteModal - Modal for reviewing and executing liquidity position
 * Combines review summary + transaction flow in a modal (Uniswap pattern)
 *
 * States:
 * - review: Shows position summary with Confirm button
 * - executing: Shows transaction steps progress
 * - success: Shows success state with View Position button
 * - error: Shows error with retry option
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  X,
  TrendingUp,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { useCreatePositionTxContext } from './CreatePositionTxContext';
import { getPoolById, getAllTokens, type TokenSymbol } from '@/lib/pools-config';
import { TransactionStatus } from './types';
import { useAddLiquidityTransaction } from '@/lib/liquidity/hooks/transaction/useAddLiquidityTransaction';
import { PositionRangeChart } from '@/components/liquidity/PositionRangeChart/PositionRangeChart';
import { PositionStatus } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb';

// Transaction step indicator
interface TransactionStepProps {
  label: string;
  description?: string;
  status: TransactionStatus;
  errorMessage?: string;
  txHash?: string;
}

function TransactionStepIndicator({
  label,
  description,
  status,
  errorMessage,
  txHash,
}: TransactionStepProps) {
  return (
    <div className="flex flex-row items-start gap-3 p-3">
      {/* Status indicator */}
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors',
        status === 'completed' && 'bg-green-500',
        status === 'in_progress' && 'bg-sidebar-primary',
        status === 'error' && 'bg-red-500',
        (status === 'pending' || status === 'idle') && 'bg-sidebar-accent'
      )}>
        {status === 'completed' && <Check className="w-3 h-3 text-white" />}
        {status === 'in_progress' && <Loader2 className="w-3 h-3 text-sidebar-background animate-spin" />}
        {status === 'error' && <AlertCircle className="w-3 h-3 text-white" />}
        {(status === 'pending' || status === 'idle') && <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className={cn(
          'text-sm font-medium',
          status === 'completed' && 'text-green-500',
          status === 'in_progress' && 'text-white',
          status === 'error' && 'text-red-500',
          (status === 'pending' || status === 'idle') && 'text-muted-foreground'
        )}>
          {label}
        </span>
        {description && status === 'in_progress' && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
        {errorMessage && status === 'error' && (
          <span className="text-xs text-red-500">{errorMessage}</span>
        )}
        {txHash && status === 'completed' && (
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-sidebar-primary hover:text-sidebar-primary/80 transition-colors"
          >
            View on Explorer
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// Token amount row
interface TokenAmountRowProps {
  symbol: string;
  icon?: string;
  amount: string;
  usdValue?: string;
}

function TokenAmountRow({ symbol, icon, amount, usdValue }: TokenAmountRowProps) {
  return (
    <div className="flex flex-row items-center justify-between py-2">
      <div className="flex items-center gap-2">
        {icon ? (
          <Image
            src={icon}
            alt={symbol}
            width={24}
            height={24}
            className="rounded-full"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-white">
            {symbol.charAt(0)}
          </div>
        )}
        <span className="text-sm font-medium text-white">{symbol}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-sm font-semibold text-white">{amount || '0'}</span>
        {usdValue && (
          <span className="text-xs text-muted-foreground">≈ ${usdValue}</span>
        )}
      </div>
    </div>
  );
}

// Modal view types
type ModalView = 'review' | 'executing' | 'success' | 'error';

export function ReviewExecuteModal() {
  const router = useRouter();
  const { state, closeReviewModal, reset, poolStateData } = useAddLiquidityContext();

  // Get transaction data from TxContext
  const {
    txInfo,
    calculatedData,
    approvalData,
    gasFeeEstimateUSD,
    usdValues,
  } = useCreatePositionTxContext();

  // Modal state
  const [view, setView] = useState<ModalView>('review');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

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
    onLiquidityAdded: (t0, t1, info) => {
      setTxHash(info?.txHash || null);
      setView('success');
    },
    onOpenChange: (isOpen) => {
      if (!isOpen) closeReviewModal();
    },
    isZapMode: state.isZapMode,
    zapInputToken: state.inputSide === 'token0' ? 'token0' : 'token1',
  });

  // Define transaction steps based on real approval state
  const steps = useMemo(() => {
    const allSteps: { id: string; label: string; description: string }[] = [];

    // Only add approval steps if actually needed (from txInfo)
    if (txInfo?.needsToken0Approval) {
      allSteps.push({
        id: 'approve0',
        label: `Approve ${pool?.currency0.symbol || 'Token 0'}`,
        description: 'Waiting for approval...',
      });
    }

    if (txInfo?.needsToken1Approval && !state.isZapMode) {
      allSteps.push({
        id: 'approve1',
        label: `Approve ${pool?.currency1.symbol || 'Token 1'}`,
        description: 'Waiting for approval...',
      });
    }

    // Permit signing step
    allSteps.push({
      id: 'permit',
      label: 'Sign Permit',
      description: 'Sign the permit in your wallet...',
    });

    // Final execution step
    allSteps.push({
      id: 'execute',
      label: state.isZapMode ? 'Swap & Create Position' : 'Create Position',
      description: 'Confirm the transaction...',
    });

    return allSteps;
  }, [pool, state.isZapMode, txInfo]);

  // Get step status
  const getStepStatus = (index: number): TransactionStatus => {
    if (error && index === currentStepIndex) return 'error';
    if (index < currentStepIndex) return 'completed';
    if (index === currentStepIndex && isExecuting) return 'in_progress';
    return 'pending';
  };

  // Calculate range label
  const rangeLabel = useMemo(() => {
    if (state.mode === 'rehypo' || state.isFullRange) {
      return 'Full Range';
    }
    return 'Custom Range';
  }, [state.mode, state.isFullRange]);

  // Calculate price bounds for chart
  const chartPrices = useMemo(() => {
    if (!txInfo || !calculatedData) {
      return { priceLower: undefined, priceUpper: undefined };
    }

    // Convert ticks to prices if we have tick data
    // For full range, prices are 0 and infinity
    if (state.isFullRange || state.mode === 'rehypo') {
      return { priceLower: 0, priceUpper: Number.MAX_SAFE_INTEGER };
    }

    // Use prices from calculatedData if available
    const priceLower = calculatedData.priceAtTickLower
      ? parseFloat(calculatedData.priceAtTickLower)
      : undefined;
    const priceUpper = calculatedData.priceAtTickUpper
      ? parseFloat(calculatedData.priceAtTickUpper)
      : undefined;

    return { priceLower, priceUpper };
  }, [txInfo, calculatedData, state.isFullRange, state.mode]);

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

  // Calculate total USD value from TxContext
  const totalUsdValue = useMemo(() => {
    const usd0 = parseFloat(usdValues?.TOKEN0 || '0');
    const usd1 = parseFloat(usdValues?.TOKEN1 || '0');
    return (usd0 + usd1).toFixed(2);
  }, [usdValues]);

  // Handle confirm - start execution with real transaction flow
  const handleConfirm = async () => {
    if (!pool) return;

    setView('executing');
    setIsExecuting(true);
    setError(null);
    setCurrentStepIndex(0);

    try {
      let stepIdx = 0;

      // Step 1: Approve token0 if needed
      if (txInfo?.needsToken0Approval) {
        setCurrentStepIndex(stepIdx);
        await handleApprove(pool.currency0.symbol as TokenSymbol, state.amount0);
        await refetchApprovals();
        stepIdx++;
      }

      // Step 2: Approve token1 if needed (not in zap mode)
      if (txInfo?.needsToken1Approval && !state.isZapMode) {
        setCurrentStepIndex(stepIdx);
        await handleApprove(pool.currency1.symbol as TokenSymbol, state.amount1);
        await refetchApprovals();
        stepIdx++;
      }

      // Step 3: Permit signing + Step 4: Execute
      // Note: handleDeposit/handleZapSwapAndDeposit handles permit signing internally
      setCurrentStepIndex(stepIdx); // Permit step
      stepIdx++;
      setCurrentStepIndex(stepIdx); // Execute step

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

      if (isUserRejection) {
        // User rejected - go back to review instead of showing error
        setView('review');
      } else {
        setError(errorMessage);
        setView('error');
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle retry
  const handleRetry = () => {
    setError(null);
    setView('review');
  };

  // Handle view position
  const handleViewPosition = () => {
    closeReviewModal();
    router.push('/portfolio');
  };

  // Handle add more
  const handleAddMore = () => {
    closeReviewModal();
    reset();
  };

  // Handle close
  const handleClose = () => {
    if (!isExecuting) {
      closeReviewModal();
      if (view === 'success') {
        reset();
      }
    }
  };

  // Reset state when modal opens
  useEffect(() => {
    if (state.isReviewModalOpen) {
      setView('review');
      setCurrentStepIndex(0);
      setIsExecuting(false);
      setError(null);
      setTxHash(null);
    }
  }, [state.isReviewModalOpen]);

  if (!pool) return null;

  return (
    <Dialog open={state.isReviewModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[420px] bg-container border-sidebar-border">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-white">
            {view === 'review' && 'Review Position'}
            {view === 'executing' && 'Creating Position'}
            {view === 'success' && 'Position Created'}
            {view === 'error' && 'Transaction Failed'}
          </DialogTitle>
        </DialogHeader>

        {/* Review View */}
        {view === 'review' && (
          <div className="flex flex-col gap-4">
            {/* Deposit amounts */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {state.isZapMode ? 'You Provide' : 'You Deposit'}
                </span>
                <span className="text-xs text-muted-foreground">
                  ~${totalUsdValue}
                </span>
              </div>
              <div className="rounded-lg bg-surface border border-sidebar-border/60 px-3 divide-y divide-sidebar-border/60">
                {state.amount0 && parseFloat(state.amount0) > 0 && (
                  <TokenAmountRow
                    symbol={pool.currency0.symbol}
                    icon={token0Config?.icon}
                    amount={state.amount0}
                    usdValue={usdValues?.TOKEN0 || '0.00'}
                  />
                )}
                {!state.isZapMode && state.amount1 && parseFloat(state.amount1) > 0 && (
                  <TokenAmountRow
                    symbol={pool.currency1.symbol}
                    icon={token1Config?.icon}
                    amount={state.amount1}
                    usdValue={usdValues?.TOKEN1 || '0.00'}
                  />
                )}
              </div>
            </div>

            {/* Position range chart */}
            {pool && state.poolId && (
              <div className="rounded-lg bg-surface border border-sidebar-border/60 p-3 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">Price Range</span>
                  <span className={cn(
                    'text-xs font-medium',
                    chartPositionStatus === PositionStatus.IN_RANGE ? 'text-green-500' : 'text-red-500'
                  )}>
                    {chartPositionStatus === PositionStatus.IN_RANGE ? 'In Range' : 'Out of Range'}
                  </span>
                </div>
                <PositionRangeChart
                  poolId={state.poolId}
                  token0={pool.currency0.symbol}
                  token1={pool.currency1.symbol}
                  priceInverted={false}
                  positionStatus={chartPositionStatus}
                  priceLower={chartPrices.priceLower}
                  priceUpper={chartPrices.priceUpper}
                  height={64}
                  className="w-full"
                />
              </div>
            )}

            {/* Position details */}
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface border border-sidebar-border/60">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pool</span>
                <span className="text-sm font-medium text-white">
                  {pool.currency0.symbol}/{pool.currency1.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Strategy</span>
                <span className={cn(
                  'text-sm font-medium',
                  state.mode === 'rehypo' ? 'text-sidebar-primary' : 'text-white'
                )}>
                  {state.mode === 'rehypo' ? 'Rehypothecation' : 'Concentrated'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Range</span>
                <span className="text-sm font-medium text-white">{rangeLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Network Fee</span>
                <span className="text-sm font-medium text-white">{gasFeeEstimateUSD || '~$2.50'}</span>
              </div>
            </div>

            {/* Rehypo info */}
            {state.mode === 'rehypo' && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-sidebar-primary/10 border border-sidebar-primary/30">
                <TrendingUp className="w-4 h-4 text-sidebar-primary shrink-0 mt-0.5" />
                <span className="text-xs text-muted-foreground">
                  Your position will earn additional yield from Aave lending markets.
                </span>
              </div>
            )}

            {/* Confirm button */}
            <Button
              onClick={handleConfirm}
              className="w-full bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
            >
              Confirm
            </Button>
          </div>
        )}

        {/* Executing View */}
        {view === 'executing' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col rounded-lg border border-sidebar-border/60 divide-y divide-sidebar-border/60">
              {steps.map((step, index) => (
                <TransactionStepIndicator
                  key={step.id}
                  label={step.label}
                  description={step.description}
                  status={getStepStatus(index)}
                />
              ))}
            </div>

            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-sidebar-primary" />
              <span className="text-sm text-muted-foreground">
                Waiting for wallet confirmation...
              </span>
            </div>
          </div>
        )}

        {/* Success View */}
        {view === 'success' && (
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-7 h-7 text-green-500" />
            </div>

            <div className="text-center">
              <p className="text-muted-foreground">
                You&apos;ve successfully added liquidity to {pool.currency0.symbol}/{pool.currency1.symbol}
              </p>
            </div>

            <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface border border-sidebar-border/60 w-full">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Deposited</span>
                <span className="text-sm font-medium text-white">
                  {state.amount0} {pool.currency0.symbol}
                  {!state.isZapMode && ` + ${state.amount1} ${pool.currency1.symbol}`}
                </span>
              </div>
              {txHash && (
                <div className="flex justify-between">
                  <span className="text-xs text-muted-foreground">Transaction</span>
                  <a
                    href={`https://basescan.org/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-sidebar-primary hover:text-sidebar-primary/80"
                  >
                    View
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 w-full">
              <Button onClick={handleViewPosition} className="w-full">
                View Position
              </Button>
              <Button variant="outline" onClick={handleAddMore} className="w-full">
                Add More Liquidity
              </Button>
            </div>
          </div>
        )}

        {/* Error View */}
        {view === 'error' && (
          <div className="flex flex-col items-center gap-5 py-4">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-500" />
            </div>

            <div className="text-center">
              <p className="text-muted-foreground">
                {error || 'Something went wrong. Please try again.'}
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full">
              <Button onClick={handleRetry} className="w-full">
                Try Again
              </Button>
              <Button variant="outline" onClick={handleClose} className="w-full">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
