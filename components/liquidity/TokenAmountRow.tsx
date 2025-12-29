"use client";

import React from 'react';
import Image from 'next/image';
import { getToken } from '@/lib/pools-config';
import { cn } from '@/lib/utils';

interface TokenAmountRowProps {
  tokenSymbol: string;
  tokenAmount: string;
  usdValue: number;
  /** Optional preview delta (positive for add, use with previewType) */
  previewDelta?: number;
  /** Whether preview is 'add' (green +) or 'remove' (red -) */
  previewType?: 'add' | 'remove';
  /** Format token amount for display */
  formatTokenDisplay?: (amount: string) => string;
  /** Optional className override */
  className?: string;
}

/**
 * Reusable token amount row component
 * Shows: [Token Logo] [USD Value] ... [Token Amount] [Symbol]
 * Optionally shows delta preview for add/remove liquidity operations
 */
export function TokenAmountRow({
  tokenSymbol,
  tokenAmount,
  usdValue,
  previewDelta,
  previewType,
  formatTokenDisplay,
  className,
}: TokenAmountRowProps) {
  const token = getToken(tokenSymbol);
  const tokenLogo = token?.icon || '/placeholder-logo.svg';

  // Format token amount for display
  const formattedAmount = formatTokenDisplay
    ? formatTokenDisplay(tokenAmount)
    : tokenAmount;

  // Format USD value
  const formattedUSD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(usdValue) ? usdValue : 0);

  // Format delta for display
  const formatDelta = (delta: number): string => {
    if (delta > 0 && delta < 0.0001) return '< 0.0001';
    return delta.toFixed(4);
  };

  const hasPreview = previewDelta !== undefined && previewDelta > 0 && previewType;
  const deltaColor = previewType === 'add' ? 'text-green-500' : 'text-red-500';
  const deltaSign = previewType === 'add' ? '+' : '-';

  return (
    <div className={cn("flex items-center justify-between", className)}>
      {/* Left side: Token icon + USD value */}
      <div className="flex items-center gap-3">
        <div className="relative w-6 h-6 rounded-full overflow-hidden">
          <Image
            src={tokenLogo}
            alt={tokenSymbol}
            width={24}
            height={24}
          />
        </div>
        <span className="text-sm font-medium">{formattedUSD}</span>
      </div>

      {/* Right side: Token amount with optional delta */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {hasPreview ? (
          <>
            <span>{formattedAmount}</span>
            <span className={deltaColor}>{deltaSign}</span>
            <span className={cn(deltaColor, "font-medium")}>
              {formatDelta(previewDelta)}
            </span>
            <span>{tokenSymbol}</span>
          </>
        ) : (
          <span>{formattedAmount} {tokenSymbol}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Simplified variant for fees (no preview delta)
 */
interface FeeAmountRowProps {
  tokenSymbol: string;
  tokenAmount: string;
  usdValue: number;
  className?: string;
}

export function FeeAmountRow({
  tokenSymbol,
  tokenAmount,
  usdValue,
  className,
}: FeeAmountRowProps) {
  const token = getToken(tokenSymbol);
  const tokenLogo = token?.icon || '/placeholder-logo.svg';

  const formattedUSD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(usdValue) ? usdValue : 0);

  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="flex items-center gap-3">
        <div className="relative w-6 h-6 rounded-full overflow-hidden">
          <Image
            src={tokenLogo}
            alt={tokenSymbol}
            width={24}
            height={24}
          />
        </div>
        <span className="text-sm font-medium">{formattedUSD}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {tokenAmount} {tokenSymbol}
      </div>
    </div>
  );
}
