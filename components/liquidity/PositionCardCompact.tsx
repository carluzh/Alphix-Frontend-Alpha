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
import { usePositionAPY as useSimplePositionAPY } from '@/hooks/useLifetimeFees';
import { MiniPoolChart } from './MiniPoolChart';
import { getDecimalsForDenomination, getOptimalBaseToken } from '@/lib/denomination-utils';

// Status indicator circle component
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

interface PositionCardCompactProps {
    position: ProcessedPosition;
    valueUSD: number;
    poolKey: string;
    getUsdPriceForSymbol: (symbol?: string) => number;
    onClick: () => void;
    isLoadingPrices: boolean;
    isLoadingPoolStates: boolean;
    prefetchedRaw0?: string | null;
    prefetchedRaw1?: string | null;
    currentPrice?: string | null;
    currentPoolTick?: number | null;
    currentPoolSqrtPriceX96?: string | null;
    poolLiquidity?: string | null;
    chainId?: number;
    convertTickToPrice: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
    onDenominationData?: (data: { denominationBase: string; minPrice: string; maxPrice: string; displayedCurrentPrice: string | null }) => void;
}

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

export function PositionCardCompact({
    position,
    valueUSD,
    poolKey,
    getUsdPriceForSymbol,
    onClick,
    isLoadingPrices,
    isLoadingPoolStates,
    currentPrice,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    poolLiquidity,
    chainId = 4002,
    convertTickToPrice,
    prefetchedRaw0,
    prefetchedRaw1,
    onDenominationData,
}: PositionCardCompactProps) {
    const [isHovered, setIsHovered] = useState(false);

    // Calculate fees
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

    // Calculate APY (simplified approach)
    // Use current timestamp minus ageSeconds as creation timestamp
    const positionCreationTimestamp = React.useMemo(() => {
        const now = Math.floor(Date.now() / 1000);
        return now - position.ageSeconds;
    }, [position.ageSeconds]);

    const { formattedAPY, isLoading: isLoadingAPY, durationDays } = useSimplePositionAPY({
        owner: position.owner,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        poolId: position.poolId,
        uncollectedFeesUSD: feesUSD,
        positionValueUSD: valueUSD,
        positionCreationTimestamp,
        enabled: !isLoadingPrices && feesUSD !== undefined && valueUSD > 0,
    });

    const apyWarning = durationDays !== null && durationDays < 7;

    // MASTER DENOMINATION STATE - All child components inherit this
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

        return {
            minPrice: isFinite(minDisplay) ? minDisplay.toString() : '0',
            maxPrice: isFinite(maxDisplay) ? maxDisplay.toString() : '∞',
            isFullRange: isFull
        };
    }, [position.tickLower, position.tickUpper, currentPrice, currentPoolTick, shouldInvert]);

    // Notify parent of denomination data for modal usage
    React.useEffect(() => {
        if (onDenominationData) {
            onDenominationData({
                denominationBase,
                minPrice,
                maxPrice,
                displayedCurrentPrice: displayedCurrentPrice?.toString() || null
            });
        }
    }, [denominationBase, minPrice, maxPrice, displayedCurrentPrice, onDenominationData]);

    // Determine status
    const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
    const statusColor = isFullRange ? 'text-green-500' : position.isInRange ? 'text-green-500' : 'text-red-500';

    return (
        <div
            className={cn(
                "relative flex flex-col rounded-lg border border-sidebar-border bg-muted/30 cursor-pointer group transition-colors overflow-hidden",
                isHovered && "border-white/20"
            )}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Loading overlay */}
            {(position as any).isOptimisticallyUpdating && (
                <div className="absolute inset-0 bg-muted/20 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                    <Image src="/LogoIconWhite.svg" alt="Updating..." width={24} height={24} className="animate-pulse opacity-75" />
                </div>
            )}

            {/* TOP SECTION - Token Info */}
            <div className={cn(
                "relative flex items-center justify-between gap-4 p-4 overflow-hidden transition-colors",
                isHovered && "bg-muted/35"
            )}>
                {/* Left: Token Images + Token Info */}
                <div className="flex items-center gap-3 min-w-0 flex-shrink">
                    {isLoadingPrices || isLoadingPoolStates ? (
                        <div className="h-8 w-16 bg-muted/60 rounded-full animate-pulse flex-shrink-0" />
                    ) : (
                        <div className="flex items-center flex-shrink-0 mr-2">
                            <TokenStack position={position as any} />
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
                <div className="hidden lg:flex flex-1 max-w-[200px] h-9 ml-auto">
                    <MiniPoolChart
                        token0={position.token0.symbol}
                        token1={position.token1.symbol}
                        denominationBase={denominationBase}
                        currentPrice={displayedCurrentPrice?.toString() || null}
                        minPrice={minPrice}
                        maxPrice={maxPrice}
                        isInRange={position.isInRange}
                        className="w-full h-full"
                    />
                </div>
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
                        <div className="text-xs font-medium font-mono">${feesUSD.toFixed(2)}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground">Fees</div>
                </div>

                {/* APY */}
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    {isLoadingAPY || isLoadingPrices || prefetchedRaw0 === null || prefetchedRaw1 === null || prefetchedRaw0 === undefined || prefetchedRaw1 === undefined ? (
                        <div className="h-4 w-10 bg-muted/60 rounded animate-pulse mb-0.5" />
                    ) : (
                        <div className="text-xs font-medium font-mono" title={apyWarning ? "Based on limited data (<7 days)" : undefined}>
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
