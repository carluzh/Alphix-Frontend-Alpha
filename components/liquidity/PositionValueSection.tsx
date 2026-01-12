"use client";

import React, { useMemo } from 'react';
import Image from 'next/image';
import { getToken } from '@/lib/pools-config';
import { cn } from '@/lib/utils';
import { TokenAmountRow } from './TokenAmountRow';

// Token color mapping for stacked bars
const getTokenColor = (symbol: string): string => {
  const colorMap: Record<string, string> = {
    'aETH': '#627EEA',
    'ETH': '#627EEA',
    'aUSDC': '#2775CA',
    'USDC': '#2775CA',
    'aUSDT': '#26A17B',
    'USDT': '#26A17B',
    'aDAI': '#F5AC37',
    'DAI': '#F5AC37',
  };
  return colorMap[symbol] || '#9CA3AF';
};

interface APRDisplay {
  value: string;
  isFallback: boolean;
  isLoading: boolean;
}

interface PreviewAmounts {
  add0: number;
  add1: number;
  remove0: number;
  remove1: number;
}

interface TokenInfo {
  symbol: string;
  amount: string;
  usdValue: number;
}

interface PositionValueSectionProps {
  /** Token 0 info */
  token0: TokenInfo;
  /** Token 1 info */
  token1: TokenInfo;
  /** Total position value in USD */
  valueUSD: number;
  /** Preview amounts for add/remove operations */
  previewAmounts?: PreviewAmounts;
  /** Fee amounts to include in preview (for add liquidity compounding) */
  feeAmounts?: { fee0: number; fee1: number };
  /** APR display configuration */
  aprDisplay?: APRDisplay;
  /** Whether fees have been earned (controls APR visibility) */
  hasEarnedFees?: boolean;
  /** Get USD price for a token symbol */
  getUsdPriceForSymbol: (symbol?: string) => number;
  /** Format token amount for display */
  formatTokenDisplayAmount: (amount: string) => string;
  /** Show stacked bars (hidden on mobile by default) */
  showStackedBars?: boolean;
  /** Compact mode for action views */
  compact?: boolean;
  /** Optional className override */
  className?: string;
}

/**
 * Position value section component
 * Shows position total USD, stacked bars breakdown, and token rows
 */
export function PositionValueSection({
  token0,
  token1,
  valueUSD,
  previewAmounts,
  feeAmounts,
  aprDisplay,
  hasEarnedFees = false,
  getUsdPriceForSymbol,
  formatTokenDisplayAmount,
  showStackedBars = true,
  compact = false,
  className,
}: PositionValueSectionProps) {
  // Get token logos
  const token0Logo = getToken(token0.symbol)?.icon || '/placeholder-logo.svg';
  const token1Logo = getToken(token1.symbol)?.icon || '/placeholder-logo.svg';

  // Token colors for stacked bars
  const token0Color = getTokenColor(token0.symbol);
  const token1Color = getTokenColor(token1.symbol);

  // Calculate preview state
  const isAdding = previewAmounts && (previewAmounts.add0 > 0 || previewAmounts.add1 > 0);
  const isRemoving = previewAmounts && (previewAmounts.remove0 > 0 || previewAmounts.remove1 > 0);

  // Calculate fees for preview (only relevant when adding)
  const fee0 = feeAmounts?.fee0 || 0;
  const fee1 = feeAmounts?.fee1 || 0;

  // Calculate adjusted total USD with preview
  const adjustedValueUSD = useMemo(() => {
    const baseValue = Number.isFinite(valueUSD) ? valueUSD : 0;

    if (isAdding && previewAmounts) {
      const add0WithFees = previewAmounts.add0 + fee0;
      const add1WithFees = previewAmounts.add1 + fee1;
      return baseValue +
        (add0WithFees * getUsdPriceForSymbol(token0.symbol)) +
        (add1WithFees * getUsdPriceForSymbol(token1.symbol));
    }

    if (isRemoving && previewAmounts) {
      return baseValue -
        (previewAmounts.remove0 * getUsdPriceForSymbol(token0.symbol)) -
        (previewAmounts.remove1 * getUsdPriceForSymbol(token1.symbol));
    }

    return baseValue;
  }, [valueUSD, previewAmounts, isAdding, isRemoving, fee0, fee1, getUsdPriceForSymbol, token0.symbol, token1.symbol]);

  // Calculate adjusted token USD values
  const token0USDBase = token0.usdValue;
  const token1USDBase = token1.usdValue;

  const adjustedToken0USD = useMemo(() => {
    if (isAdding && previewAmounts) {
      return token0USDBase + ((previewAmounts.add0 + fee0) * getUsdPriceForSymbol(token0.symbol));
    }
    if (isRemoving && previewAmounts) {
      return token0USDBase - (previewAmounts.remove0 * getUsdPriceForSymbol(token0.symbol));
    }
    return token0USDBase;
  }, [token0USDBase, previewAmounts, isAdding, isRemoving, fee0, getUsdPriceForSymbol, token0.symbol]);

  const adjustedToken1USD = useMemo(() => {
    if (isAdding && previewAmounts) {
      return token1USDBase + ((previewAmounts.add1 + fee1) * getUsdPriceForSymbol(token1.symbol));
    }
    if (isRemoving && previewAmounts) {
      return token1USDBase - (previewAmounts.remove1 * getUsdPriceForSymbol(token1.symbol));
    }
    return token1USDBase;
  }, [token1USDBase, previewAmounts, isAdding, isRemoving, fee1, getUsdPriceForSymbol, token1.symbol]);

  // Calculate stacked bar percentages
  const positionBars = useMemo(() => {
    const total = adjustedToken0USD + adjustedToken1USD;
    if (total === 0) return null;
    return {
      token0Percent: (adjustedToken0USD / total) * 100,
      token1Percent: (adjustedToken1USD / total) * 100,
    };
  }, [adjustedToken0USD, adjustedToken1USD]);

  // Calculate preview delta for token rows
  const getToken0PreviewDelta = () => {
    if (isAdding && previewAmounts) return previewAmounts.add0 + fee0;
    if (isRemoving && previewAmounts) return previewAmounts.remove0;
    return undefined;
  };

  const getToken1PreviewDelta = () => {
    if (isAdding && previewAmounts) return previewAmounts.add1 + fee1;
    if (isRemoving && previewAmounts) return previewAmounts.remove1;
    return undefined;
  };

  const getPreviewType = (): 'add' | 'remove' | undefined => {
    if (isAdding) return 'add';
    if (isRemoving) return 'remove';
    return undefined;
  };

  // Format USD for display
  const formatUSD = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);

  // Show APR only if there are actual fees earned
  const showAPR = aprDisplay &&
    !aprDisplay.isLoading &&
    aprDisplay.value &&
    aprDisplay.value !== '–' &&
    aprDisplay.value !== '0%' &&
    hasEarnedFees;

  return (
    <div className={cn(
      "bg-container-secondary border border-sidebar-border rounded-lg p-4 md:p-5",
      className
    )}>
      <div className="flex flex-col gap-3 md:gap-5">
        {/* Label + Total USD */}
        <div className="flex flex-col gap-2 relative">
          {/* APR Badge - only show if there are actual fees earned */}
          {showAPR && (
            <div className="absolute top-0 right-0 border border-dashed border-sidebar-border/60 rounded-lg p-2 flex items-center gap-1 group/apr cursor-help">
              <div className="flex flex-col items-start gap-0">
                <div className="text-sm font-normal leading-none">
                  {aprDisplay.value}
                </div>
              </div>

              {/* Tooltip */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-popover border border-sidebar-border rounded-md shadow-lg opacity-0 group-hover/apr:opacity-100 pointer-events-none transition-opacity duration-200 w-48 text-xs text-popover-foreground z-[100]">
                {aprDisplay.isFallback ? (
                  <p><span className="font-bold">APR:</span> Pool-wide estimate. Actual APR calculated from position fees.</p>
                ) : (
                  <p><span className="font-bold">APR:</span> Calculated from your position&apos;s accumulated fees.</p>
                )}
                {/* Tooltip arrow */}
                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-sidebar-border"></div>
              </div>
            </div>
          )}

          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
          <div className="text-lg md:text-xl font-semibold">
            {formatUSD(adjustedValueUSD)}
          </div>
        </div>

        {/* Stacked Bars - hidden on mobile */}
        {showStackedBars && positionBars && (
          <div className="hidden md:flex flex-col gap-2">
            <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
              <div
                className="h-full"
                style={{
                  width: `${positionBars.token0Percent}%`,
                  backgroundColor: token0Color
                }}
              />
              <div
                className="h-full"
                style={{
                  width: `${positionBars.token1Percent}%`,
                  backgroundColor: token1Color
                }}
              />
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="relative w-4 h-4 rounded-full overflow-hidden">
                  <Image
                    src={token0Logo}
                    alt={token0.symbol}
                    width={16}
                    height={16}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {positionBars.token0Percent.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative w-4 h-4 rounded-full overflow-hidden">
                  <Image
                    src={token1Logo}
                    alt={token1.symbol}
                    width={16}
                    height={16}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {positionBars.token1Percent.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Token Amounts */}
        <div className="flex flex-col gap-3 md:gap-4">
          <TokenAmountRow
            tokenSymbol={token0.symbol}
            tokenAmount={token0.amount}
            usdValue={adjustedToken0USD}
            previewDelta={getToken0PreviewDelta()}
            previewType={getPreviewType()}
            formatTokenDisplay={formatTokenDisplayAmount}
          />
          <TokenAmountRow
            tokenSymbol={token1.symbol}
            tokenAmount={token1.amount}
            usdValue={adjustedToken1USD}
            previewDelta={getToken1PreviewDelta()}
            previewType={getPreviewType()}
            formatTokenDisplay={formatTokenDisplayAmount}
          />
        </div>
      </div>
    </div>
  );
}
