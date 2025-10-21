"use client";

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TokenStack } from "./TokenStack";
import { formatUnits } from "viem";
import { TOKEN_DEFINITIONS, getToken } from "@/lib/pools-config";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { PositionChartV2 } from "./PositionChartV2";
import { getOptimalBaseToken } from "@/lib/denomination-utils";

// Status indicator component
function StatusIndicatorCircle({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={className}>
      <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4" />
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

type ProcessedPosition = {
  positionId: string;
  owner: string;
  poolId: string;
  token0: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  token1: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  tickLower: number;
  tickUpper: number;
  isInRange: boolean;
  ageSeconds: number;
  blockTimestamp: number;
};

interface PositionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ProcessedPosition;
  valueUSD: number;
  prefetchedRaw0?: string | null;
  prefetchedRaw1?: string | null;
  formatTokenDisplayAmount: (amount: string) => string;
  getUsdPriceForSymbol: (symbol?: string) => number;
  onAddLiquidity: () => void;
  onWithdraw: () => void;
  onClaimFees: () => void;
  currentPrice?: string | null;
  currentPoolTick?: number | null;
  convertTickToPrice?: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
  apr?: number | null;
  isLoadingAPR?: boolean;
  feeTier?: number | null; // Fee in basis points (e.g., 30 for 0.30%)
  selectedPoolId?: string;
  chainId?: number;
  currentPoolSqrtPriceX96?: string | null;
  sdkMinTick?: number;
  sdkMaxTick?: number;
  defaultTickSpacing?: number;
  poolToken0?: any;
  poolToken1?: any;
  // NEW: Denomination data from parent PositionCard
  denominationBase?: string;
  initialMinPrice?: string;
  initialMaxPrice?: string;
  initialCurrentPrice?: string | null;
}

// Helper to extract average color from token icon (fallback to hardcoded colors)
const getTokenColor = (symbol: string): string => {
  // Fallback color mapping based on common tokens
  const colorMap: Record<string, string> = {
    'aETH': '#627EEA',
    'ETH': '#627EEA',
    'aUSDC': '#2775CA',
    'USDC': '#2775CA',
    'aUSDT': '#26A17B',
    'USDT': '#26A17B',
    'aDAI': '#F5AC37',
    'DAI': '#F5AC37',
    'WETH': '#627EEA',
  };
  return colorMap[symbol] || '#9CA3AF'; // Default gray
};

export function PositionDetailsModal({
  isOpen,
  onClose,
  position,
  valueUSD,
  prefetchedRaw0,
  prefetchedRaw1,
  formatTokenDisplayAmount,
  getUsdPriceForSymbol,
  onAddLiquidity,
  onWithdraw,
  onClaimFees,
  feeTier,
  selectedPoolId,
  chainId,
  currentPrice,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  sdkMinTick = -887272,
  sdkMaxTick = 887272,
  defaultTickSpacing = 60,
  poolToken0,
  poolToken1,
  denominationBase,
  initialMinPrice,
  initialMaxPrice,
  initialCurrentPrice,
}: PositionDetailsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [chartKey, setChartKey] = useState(0);

  // Format fee tier for display (exactly like pool stats bar)
  const feeTierDisplay = useMemo(() => {
    if (feeTier === null || feeTier === undefined) return null;
    // feeTier is dynamicFeeBps, divide by 100 to get percentage
    const pct = feeTier / 100;
    const formatted = pct < 0.1 ? pct.toFixed(3) : pct.toFixed(2);
    return `${formatted}%`;
  }, [feeTier]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Increment chartKey when modal opens to force data refetch
  useEffect(() => {
    if (isOpen) {
      setChartKey(prev => prev + 1);
    }
  }, [isOpen]);

  // Calculate fees
  const { feeAmount0, feeAmount1, feesUSD, hasZeroFees } = useMemo(() => {
    if (prefetchedRaw0 === null || prefetchedRaw1 === null) {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: false };
    }

    try {
      const raw0 = prefetchedRaw0 || '0';
      const raw1 = prefetchedRaw1 || '0';

      const d0 = TOKEN_DEFINITIONS?.[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
      const d1 = TOKEN_DEFINITIONS?.[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;

      const fee0 = parseFloat(formatUnits(BigInt(raw0), d0));
      const fee1 = parseFloat(formatUnits(BigInt(raw1), d1));

      const price0 = getUsdPriceForSymbol(position.token0.symbol);
      const price1 = getUsdPriceForSymbol(position.token1.symbol);

      const usdFees = (fee0 * price0) + (fee1 * price1);
      const hasZero = BigInt(raw0) <= 0n && BigInt(raw1) <= 0n;

      return {
        feeAmount0: fee0,
        feeAmount1: fee1,
        feesUSD: usdFees,
        hasZeroFees: hasZero
      };
    } catch {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: true };
    }
  }, [prefetchedRaw0, prefetchedRaw1, position, getUsdPriceForSymbol]);

  // Calculate individual token USD values
  const token0USD = parseFloat(position.token0.amount) * getUsdPriceForSymbol(position.token0.symbol);
  const token1USD = parseFloat(position.token1.amount) * getUsdPriceForSymbol(position.token1.symbol);

  const fee0USD = feeAmount0 * getUsdPriceForSymbol(position.token0.symbol);
  const fee1USD = feeAmount1 * getUsdPriceForSymbol(position.token1.symbol);

  // Calculate denomination if not provided by parent
  const calculatedDenominationBase = useMemo(() => {
    if (denominationBase) return denominationBase;
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(position.token0.symbol, position.token1.symbol, priceNum);
  }, [denominationBase, currentPrice, position.token0.symbol, position.token1.symbol]);

  const { calculatedMinPrice, calculatedMaxPrice, calculatedCurrentPrice } = useMemo(() => {
    if (initialMinPrice && initialMaxPrice && initialCurrentPrice !== undefined) {
      return {
        calculatedMinPrice: initialMinPrice,
        calculatedMaxPrice: initialMaxPrice,
        calculatedCurrentPrice: initialCurrentPrice
      };
    }

    const shouldInvert = calculatedDenominationBase === position.token0.symbol;

    let minPoolPrice: number;
    let maxPoolPrice: number;

    if (currentPrice && currentPoolTick !== null && currentPoolTick !== undefined) {
      const currentPriceNum = parseFloat(currentPrice);
      if (isFinite(currentPriceNum)) {
        minPoolPrice = currentPriceNum * Math.pow(1.0001, position.tickLower - currentPoolTick);
        maxPoolPrice = currentPriceNum * Math.pow(1.0001, position.tickUpper - currentPoolTick);
      } else {
        minPoolPrice = Math.pow(1.0001, position.tickLower);
        maxPoolPrice = Math.pow(1.0001, position.tickUpper);
      }
    } else {
      minPoolPrice = Math.pow(1.0001, position.tickLower);
      maxPoolPrice = Math.pow(1.0001, position.tickUpper);
    }

    const minDisplay = shouldInvert ? (1 / maxPoolPrice) : minPoolPrice;
    const maxDisplay = shouldInvert ? (1 / minPoolPrice) : maxPoolPrice;

    let displayedCurrentPrice: string | null = null;
    if (currentPrice) {
      const priceNum = parseFloat(currentPrice);
      if (isFinite(priceNum)) {
        displayedCurrentPrice = (shouldInvert ? (1 / priceNum) : priceNum).toString();
      }
    }

    return {
      calculatedMinPrice: isFinite(minDisplay) ? minDisplay.toString() : '0',
      calculatedMaxPrice: isFinite(maxDisplay) ? maxDisplay.toString() : '∞',
      calculatedCurrentPrice: displayedCurrentPrice
    };
  }, [initialMinPrice, initialMaxPrice, initialCurrentPrice, calculatedDenominationBase, position, currentPrice, currentPoolTick]);

  // Use calculated or inherited values
  const minPriceActual = calculatedMinPrice;
  const maxPriceActual = calculatedMaxPrice;
  const currentPriceActual = calculatedCurrentPrice;

  // Check if full range
  const SDK_MIN_TICK = -887272;
  const SDK_MAX_TICK = 887272;
  const isFullRange = Math.abs(position.tickLower - SDK_MIN_TICK) < 1000 &&
                      Math.abs(position.tickUpper - SDK_MAX_TICK) < 1000;

  const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
  const statusColor = isFullRange ? 'text-green-500' : position.isInRange ? 'text-green-500' : 'text-red-500';

  // Get token logos
  const getTokenLogo = (symbol: string) => {
    const token = getToken(symbol);
    return token?.icon || '/placeholder-logo.svg';
  };

  // Get token colors for bars
  const token0Color = getTokenColor(position.token0.symbol);
  const token1Color = getTokenColor(position.token1.symbol);

  // Calculate percentage bars for position
  const positionBars = useMemo(() => {
    const total = token0USD + token1USD;
    if (total === 0) return null;

    const token0Percent = (token0USD / total) * 100;
    const token1Percent = (token1USD / total) * 100;

    return { token0Percent, token1Percent };
  }, [token0USD, token1USD]);

  // Calculate percentage bars for fees
  const feesBars = useMemo(() => {
    const total = fee0USD + fee1USD;
    if (total === 0 || hasZeroFees) return null;

    const fee0Percent = (fee0USD / total) * 100;
    const fee1Percent = (fee1USD / total) * 100;

    return { fee0Percent, fee1Percent };
  }, [fee0USD, fee1USD, hasZeroFees]);

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md cursor-default"
      style={{
        pointerEvents: 'auto',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)'
      }}
      onMouseDown={(e) => {
        // Only close if clicking directly on backdrop (not bubbling from child)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default"
        style={{
          width: '1000px',
          maxWidth: '95vw',
          maxHeight: '95vh',
          backgroundColor: 'var(--modal-background)',
          borderColor: 'var(--border-primary)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60 flex-shrink-0">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">POSITION INFORMATION</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
            >
              <span className="text-lg">×</span>
            </Button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto px-4 pt-4 pb-4 space-y-4 flex-1 min-h-0">
            {/* Top Bar - Token Info with Status and Fee Tier */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <TokenStack position={position as any} />
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">
                    {position.token0.symbol} / {position.token1.symbol}
                  </h3>
                  <div className="flex items-center gap-2">
                    {feeTierDisplay && (
                      <Badge
                        variant="secondary"
                        className="bg-muted/30 text-muted-foreground border border-sidebar-border/60 text-[11px] h-5 px-1.5"
                      >
                        {feeTierDisplay}
                      </Badge>
                    )}
                    <div className={cn("flex items-center gap-1.5", statusColor)}>
                      <StatusIndicatorCircle className={statusColor} />
                      <span className="text-[11px] font-medium">{statusText}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={onAddLiquidity}
                  variant="outline"
                  className="h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Add Liquidity
                </Button>
                <Button
                  onClick={onWithdraw}
                  variant="outline"
                  className="h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Remove Liquidity
                </Button>
                <div className="h-10 w-px bg-border flex-shrink-0" />
                <Button
                  onClick={onClaimFees}
                  disabled={hasZeroFees}
                  variant="outline"
                  className="h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110 disabled:opacity-50"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Collect Fees
                </Button>
              </div>
            </div>

            {/* Charts Section - Price Chart + Liquidity Depth */}
            <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2">
              <div style={{ height: '220px' }} className="relative">
                {selectedPoolId ? (
                  <PositionChartV2
                    token0={position.token0.symbol}
                    token1={position.token1.symbol}
                    denominationBase={calculatedDenominationBase}
                    currentPrice={currentPriceActual ?? undefined}
                    currentPoolTick={currentPoolTick ?? undefined}
                    minPrice={minPriceActual}
                    maxPrice={maxPriceActual}
                    isInRange={position.isInRange}
                    selectedPoolId={selectedPoolId}
                    chartKey={chartKey}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-2">
                    <Image
                      src="/LogoIconWhite.svg"
                      alt="Loading chart"
                      width={32}
                      height={32}
                      className="animate-pulse opacity-75"
                    />
                    <span className="text-xs text-muted-foreground">
                      Pool ID not provided
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Position and Fees Sections - Horizontal Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Position Section */}
              <div className="bg-container-secondary border border-sidebar-border rounded-lg p-5">
                <div className="flex flex-col gap-5">
                  {/* Label + Total USD */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
                    <div className="text-xl font-semibold">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }).format(Number.isFinite(valueUSD) ? valueUSD : 0)}
                    </div>
                  </div>

                  {/* Stacked Bars */}
                  {positionBars && (
                    <div className="flex flex-col gap-2">
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
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                  <div className="flex flex-col gap-4">
                    {/* Token 0 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(position.token0.symbol)}
                            alt={position.token0.symbol}
                            width={24}
                            height={24}
                          />
                        </div>
                        <span className="text-sm font-medium">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }).format(token0USD)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}
                      </div>
                    </div>

                    {/* Token 1 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(position.token1.symbol)}
                            alt={position.token1.symbol}
                            width={24}
                            height={24}
                          />
                        </div>
                        <span className="text-sm font-medium">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }).format(token1USD)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fees Earned Section */}
              <div className="bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-5">
                <div className="flex flex-col gap-5">
                  {/* Label + Total Fees */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
                    <div className="text-xl font-semibold">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }).format(feesUSD)}
                    </div>
                  </div>

                  {/* Stacked Bars for Fees */}
                  {feesBars && (
                    <div className="flex flex-col gap-2">
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
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                      {/* Fee 0 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(fee0USD)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {feeAmount0 < 0.001 && feeAmount0 > 0
                            ? "< 0.001"
                            : feeAmount0.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 })
                          } {position.token0.symbol}
                        </div>
                      </div>

                      {/* Fee 1 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(fee1USD)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {feeAmount1 < 0.001 && feeAmount1 > 0
                            ? "< 0.001"
                            : feeAmount1.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 })
                          } {position.token1.symbol}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No fees earned yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
