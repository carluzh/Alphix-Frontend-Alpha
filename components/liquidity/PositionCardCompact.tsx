"use client"

/**
 * Position Card - Mirroring Uniswap's FULL LiquidityPositionCard design
 *
 * Structure:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Top Section (padding 24px)                                  │
 * │ ┌──────────────┬──────────────┬──────────────┐             │
 * │ │ Token Info   │ Price Chart  │ (Range)      │             │
 * │ │ - Icons      │              │              │             │
 * │ │ - Pair       │              │              │             │
 * │ │ - Badges     │              │              │             │
 * │ │ - Status     │              │              │             │
 * │ └──────────────┴──────────────┴──────────────┘             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Bottom Section (padding 16px, background surface2)          │
 * │ ┌──────────┬──────────┬──────────┬──────────────┐          │
 * │ │ Position │ Fees     │ APR      │ Min-Max Range│          │
 * │ │ $X.XX    │ $X.XX    │ X.X%     │ X - Y        │          │
 * │ └──────────┴──────────┴──────────┴──────────────┘          │
 * └─────────────────────────────────────────────────────────────┘
 */

import React, { useState } from 'react';
import Image from "next/image";
import { formatUnits } from "viem";
import { TokenStack } from "./TokenStack";
import { TOKEN_DEFINITIONS } from '@/lib/pools-config';
import { cn } from "@/lib/utils";
import { MiniPoolChart } from './MiniPoolChart';
import { getDecimalsForDenomination, getOptimalBaseToken } from '@/lib/denomination-utils';
import { calculateClientAPY } from '@/lib/client-apy';
import { ArrowUpRight } from 'lucide-react';

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
    lastTimestamp: number; // Last modification timestamp (for APY calculation)
    // Optimistic UI state - added dynamically during liquidity modifications
    isOptimisticallyUpdating?: boolean;
};

interface PositionCardCompactProps {
    position: ProcessedPosition;
    valueUSD: number;
    onClick: () => void;
    getUsdPriceForSymbol: (symbol?: string) => number;
    convertTickToPrice: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
    poolContext: {
        currentPrice: string | null;
        currentPoolTick: number | null;
        poolAPY: number | null;
        isLoadingPrices: boolean;
        isLoadingPoolStates: boolean;
    };
    fees: {
        raw0: string | null;
        raw1: string | null;
    };
    onDenominationData?: (data: { denominationBase: string; minPrice: string; maxPrice: string; displayedCurrentPrice: string | null; feesUSD: number; formattedAPY: string; isAPYFallback: boolean; isLoadingAPY: boolean }) => void;
    showMenuButton?: boolean;
    onVisitPool?: () => void;
}

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

export function PositionCardCompact({
    position,
    valueUSD,
    onClick,
    getUsdPriceForSymbol,
    convertTickToPrice,
    poolContext,
    fees,
    onDenominationData,
    showMenuButton = false,
    onVisitPool,
}: PositionCardCompactProps) {
    const [isHovered, setIsHovered] = useState(false);
    const { currentPrice, currentPoolTick, poolAPY, isLoadingPrices, isLoadingPoolStates } = poolContext;
    const { raw0: prefetchedRaw0, raw1: prefetchedRaw1 } = fees;

    const { feesUSD, hasZeroFees } = React.useMemo(() => {
        if (prefetchedRaw0 === null || prefetchedRaw1 === null) {
            return { feesUSD: 0, hasZeroFees: false };
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

            return { feesUSD: usdFees, hasZeroFees: hasZero };
        } catch {
            return { feesUSD: 0, hasZeroFees: true };
        }
    }, [prefetchedRaw0, prefetchedRaw1, position, getUsdPriceForSymbol]);

    const denominationBase = React.useMemo(() => {
        const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
        return getOptimalBaseToken(position.token0.symbol, position.token1.symbol, priceNum);
    }, [position.token0.symbol, position.token1.symbol, currentPrice]);

    const shouldInvert = denominationBase === position.token0.symbol;

    const displayedCurrentPrice = React.useMemo(() => {
        if (!currentPrice) return null;
        const priceNum = parseFloat(currentPrice);
        if (!isFinite(priceNum)) return null;
        return shouldInvert ? (1 / priceNum) : priceNum;
    }, [currentPrice, shouldInvert]);

    const { minPrice, maxPrice, isFullRange } = React.useMemo(() => {
        const isFull = Math.abs(position.tickLower - SDK_MIN_TICK) < 1000 &&
                       Math.abs(position.tickUpper - SDK_MAX_TICK) < 1000;

        const lowerPriceStr = convertTickToPrice(
            position.tickLower, currentPoolTick ?? null, currentPrice ?? null,
            denominationBase, position.token0.symbol, position.token1.symbol
        );

        const upperPriceStr = convertTickToPrice(
            position.tickUpper, currentPoolTick ?? null, currentPrice ?? null,
            denominationBase, position.token0.symbol, position.token1.symbol
        );

        return {
            minPrice: shouldInvert ? upperPriceStr : lowerPriceStr,
            maxPrice: shouldInvert ? lowerPriceStr : upperPriceStr,
            isFullRange: isFull
        };
    }, [position.tickLower, position.tickUpper, currentPrice, currentPoolTick, denominationBase, position.token0.symbol, position.token1.symbol, convertTickToPrice, shouldInvert]);

    const { formattedAPY, isFallback: isAPYFallback, isLoading: isLoadingAPY } = React.useMemo(() => {
        if (isLoadingPrices || valueUSD <= 0 || poolAPY === undefined) {
            return { formattedAPY: '—', isFallback: false, isLoading: true };
        }
        if (!position.isInRange && !isFullRange) {
            return { formattedAPY: '0.00%', isFallback: false, isLoading: false };
        }
        const result = calculateClientAPY(feesUSD, valueUSD, position.lastTimestamp || position.blockTimestamp, poolAPY);
        return { ...result, isLoading: false };
    }, [feesUSD, valueUSD, position.lastTimestamp, position.blockTimestamp, poolAPY, isLoadingPrices, position.isInRange, isFullRange]);

    // Notify parent of denomination data for modal usage
    React.useEffect(() => {
        if (onDenominationData) {
            onDenominationData({
                denominationBase,
                minPrice,
                maxPrice,
                displayedCurrentPrice: displayedCurrentPrice?.toString() || null,
                feesUSD,
                formattedAPY,
                isAPYFallback,
                isLoadingAPY
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [denominationBase, minPrice, maxPrice, displayedCurrentPrice, feesUSD, formattedAPY, isAPYFallback, isLoadingAPY]);

    // Determine status
    const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
    const statusColor = isFullRange ? 'text-green-500' : position.isInRange ? 'text-green-500' : 'text-red-500';

    return (
        <div
            className={cn(
                "relative flex flex-col rounded-lg border border-sidebar-border bg-muted/30 cursor-pointer group transition-colors",
                showMenuButton ? "overflow-visible" : "overflow-hidden",
                isHovered && "border-white/20"
            )}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Loading overlay */}
            {position.isOptimisticallyUpdating && (
                <div className="absolute inset-0 bg-muted/20 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                    <Image src="/LogoIconWhite.svg" alt="Updating..." width={24} height={24} className="animate-pulse opacity-75" />
                </div>
            )}

            {/* TOP SECTION - Token Info */}
            <div className={cn(
                "relative flex items-center justify-between gap-4 p-4 overflow-visible transition-colors",
                isHovered && "bg-muted/35"
            )}>
                {/* Left: Token Images + Token Info */}
                <div className="flex items-center gap-3 min-w-0 flex-shrink">
                    {isLoadingPrices || isLoadingPoolStates ? (
                        <div className="h-8 w-16 bg-muted/60 rounded-full animate-pulse flex-shrink-0" />
                    ) : (
                        <div className="flex items-center flex-shrink-0 mr-2">
                            <TokenStack position={position} />
                        </div>
                    )}
                    <div className="flex flex-col justify-center gap-0.5 min-w-0">
                        <div className="text-sm font-normal">
                            {position.token0.symbol} / {position.token1.symbol}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={cn("flex items-center gap-1.5 text-xs", statusColor)}>
                                <StatusIndicatorCircle className={statusColor} />
                                <span>{statusText}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right: Mini Chart */}
                <div className="hidden lg:flex flex-1 max-w-[200px] h-9 ml-auto cursor-pointer">
                    <MiniPoolChart
                        token0={position.token0.symbol}
                        token1={position.token1.symbol}
                        denominationBase={denominationBase}
                        currentPrice={displayedCurrentPrice?.toString() || null}
                        minPrice={minPrice}
                        maxPrice={maxPrice}
                        isInRange={position.isInRange}
                        isFullRange={isFullRange}
                        className="w-full h-full"
                    />
                </div>

                {/* Visit Pool Button (Portfolio only) */}
                {showMenuButton && isHovered && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onVisitPool?.();
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded bg-muted/60 hover:bg-muted transition-all z-10"
                    >
                        <ArrowUpRight className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* BOTTOM SECTION - Position, Fees, APR, Range */}
            <div className={cn(
                "flex items-center justify-between gap-5 py-1.5 px-4 rounded-b-lg transition-colors",
                isHovered ? "bg-muted/50" : "bg-muted/30"
            )}>
                {/* Position */}
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    {isLoadingPrices ? (
                        <div className="h-4 w-16 bg-muted/60 rounded animate-pulse mb-0.5" />
                    ) : (
                        <div className="text-xs font-medium font-mono">
                            {new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            }).format(Number.isFinite(valueUSD) ? valueUSD : 0)}
                        </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">Position</div>
                </div>

                {/* Fees */}
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    {isLoadingPrices || prefetchedRaw0 === null || prefetchedRaw1 === null || prefetchedRaw0 === undefined || prefetchedRaw1 === undefined ? (
                        <div className="h-4 w-14 bg-muted/60 rounded animate-pulse mb-0.5" />
                    ) : (
                        <div className={cn(
                            "text-xs font-medium font-mono",
                            feesUSD === 0 && "text-white/50"
                        )}>
                            ${feesUSD.toFixed(2)}
                        </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">Fees</div>
                </div>

                {/* APY */}
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    {isLoadingAPY ? (
                        <div className="h-4 w-12 bg-muted/60 rounded animate-pulse" />
                    ) : (
                        <div className={cn(
                            "text-xs font-medium font-mono",
                            isAPYFallback && "text-white/50"
                        )}>
                            {formattedAPY}
                        </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">APY</div>
                </div>

                {/* Range - Hidden on mobile, shown on desktop */}
                <div className="hidden lg:flex flex-col gap-0.5 flex-1 min-w-0">
                    {isFullRange ? (
                        <div className="text-xs font-medium font-mono">Full range</div>
                    ) : (
                        <div className="text-xs text-foreground truncate font-mono flex items-center gap-1">
                            <span>{(() => {
                                const decimals = getDecimalsForDenomination(denominationBase);
                                const v = parseFloat(minPrice);
                                if (!isFinite(v)) return '∞';
                                const threshold = Math.pow(10, -decimals);
                                if (v > 0 && v < threshold) return `<${threshold.toFixed(decimals)}`;
                                const formatted = v.toLocaleString('en-US', {
                                    maximumFractionDigits: decimals,
                                    minimumFractionDigits: Math.min(2, decimals)
                                });
                                if (formatted === '0.00' && v > 0) return `<${threshold.toFixed(decimals)}`;
                                return formatted;
                            })()}</span>
                            <span className="text-muted-foreground">-</span>
                            <span>{(() => {
                                const decimals = getDecimalsForDenomination(denominationBase);
                                const v = parseFloat(maxPrice);
                                if (!isFinite(v)) return '∞';
                                const threshold = Math.pow(10, -decimals);
                                if (v > 0 && v < threshold) return `<${threshold.toFixed(decimals)}`;
                                const formatted = v.toLocaleString('en-US', {
                                    maximumFractionDigits: decimals,
                                    minimumFractionDigits: Math.min(2, decimals)
                                });
                                if (formatted === '0.00' && v > 0) return `<${threshold.toFixed(decimals)}`;
                                return formatted;
                            })()}</span>
                        </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">Range</div>
                </div>
            </div>
        </div>
    );
}
