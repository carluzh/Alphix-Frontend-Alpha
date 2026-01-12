"use client";

import React, { useMemo } from 'react';
import Image from 'next/image';
import { CornerRightUp, Minus } from 'lucide-react';
import { IconMinus } from 'nucleo-micro-bold-essential';
import { getToken } from '@/lib/pools-config';
import { cn } from '@/lib/utils';
import { FeeAmountRow } from './TokenAmountRow';

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

interface FeeInfo {
  symbol: string;
  amount: string; // Formatted display amount
  usdValue: number;
}

interface FeesEarnedSectionProps {
  /** Token 0 fee info */
  fee0: FeeInfo;
  /** Token 1 fee info */
  fee1: FeeInfo;
  /** Total fees USD value */
  totalFeesUSD: number;
  /** Whether fees are zero/empty */
  hasZeroFees: boolean;
  /** Whether adding liquidity (shows compound/collect badge) */
  isAddingLiquidity?: boolean;
  /** Whether removing liquidity (shows withdraw badge) */
  isRemovingLiquidity?: boolean;
  /** Whether position is out of range with uncollected fees */
  hasUncollectedFees?: boolean;
  /** Show stacked bars (hidden on mobile by default) */
  showStackedBars?: boolean;
  /** Optional className override */
  className?: string;
}

/**
 * Fees earned section component
 * Shows total fees USD, stacked bars breakdown, and fee token rows
 * Includes contextual badges for add/remove liquidity operations
 */
export function FeesEarnedSection({
  fee0,
  fee1,
  totalFeesUSD,
  hasZeroFees,
  isAddingLiquidity = false,
  isRemovingLiquidity = false,
  hasUncollectedFees = false,
  showStackedBars = true,
  className,
}: FeesEarnedSectionProps) {
  // Get token logos
  const token0Logo = getToken(fee0.symbol)?.icon || '/placeholder-logo.svg';
  const token1Logo = getToken(fee1.symbol)?.icon || '/placeholder-logo.svg';

  // Token colors for stacked bars
  const token0Color = getTokenColor(fee0.symbol);
  const token1Color = getTokenColor(fee1.symbol);

  // Calculate stacked bar percentages
  const feesBars = useMemo(() => {
    const total = fee0.usdValue + fee1.usdValue;
    if (total === 0 || hasZeroFees) return null;
    return {
      fee0Percent: (fee0.usdValue / total) * 100,
      fee1Percent: (fee1.usdValue / total) * 100,
    };
  }, [fee0.usdValue, fee1.usdValue, hasZeroFees]);

  // Determine total USD color based on action state
  const getTotalUSDColor = () => {
    if (isAddingLiquidity && !hasZeroFees && !hasUncollectedFees) return 'text-green-500';
    if (isAddingLiquidity && !hasZeroFees && hasUncollectedFees) return 'text-red-500';
    if (isRemovingLiquidity && !hasZeroFees) return 'text-red-500';
    return '';
  };

  // Format USD for display
  const formatUSD = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);

  // Render action badge
  const renderBadge = () => {
    if (hasZeroFees) return null;

    if (isAddingLiquidity) {
      return (
        <div className="absolute top-5 right-5 group">
          {hasUncollectedFees ? (
            <>
              <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                <IconMinus className="h-3.5 w-3.5" />
              </div>
              <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                Fees collected first
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500/20 text-green-500">
                <CornerRightUp className="h-3.5 w-3.5" strokeWidth={2.5} />
              </div>
              <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                Fees are compounded
              </div>
            </>
          )}
        </div>
      );
    }

    if (isRemovingLiquidity) {
      return (
        <div className="absolute top-5 right-5 group">
          <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
            <IconMinus className="h-3.5 w-3.5" strokeWidth={2.5} />
          </div>
          <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
            Fees are withdrawn
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn(
      "bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-4 md:p-5 relative",
      className
    )}>
      <div className="flex flex-col gap-3 md:gap-5">
        {/* Badge - Top Right */}
        {renderBadge()}

        {/* Label + Total Fees */}
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
          <div className={cn("text-lg md:text-xl font-semibold", getTotalUSDColor())}>
            {formatUSD(totalFeesUSD)}
          </div>
        </div>

        {/* Stacked Bars for Fees - hidden on mobile */}
        {showStackedBars && feesBars && (
          <div className="hidden md:flex flex-col gap-2">
            <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
              <div
                className="h-full"
                style={{
                  width: `${feesBars.fee0Percent}%`,
                  backgroundColor: token0Color
                }}
              />
              <div
                className="h-full"
                style={{
                  width: `${feesBars.fee1Percent}%`,
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
                    alt={fee0.symbol}
                    width={16}
                    height={16}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {feesBars.fee0Percent.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative w-4 h-4 rounded-full overflow-hidden">
                  <Image
                    src={token1Logo}
                    alt={fee1.symbol}
                    width={16}
                    height={16}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {feesBars.fee1Percent.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Fee Amounts */}
        {!hasZeroFees ? (
          <div className="flex flex-col gap-4">
            <FeeAmountRow
              tokenSymbol={fee0.symbol}
              tokenAmount={fee0.amount}
              usdValue={fee0.usdValue}
            />
            <FeeAmountRow
              tokenSymbol={fee1.symbol}
              tokenAmount={fee1.amount}
              usdValue={fee1.usdValue}
            />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No fees earned yet
          </div>
        )}
      </div>
    </div>
  );
}
