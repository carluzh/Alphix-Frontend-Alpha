"use client"

import React, { useState, useMemo } from 'react';
import Image from "next/image";
import { formatUnits } from "viem";
import { TokenStack } from "./TokenStack";
import { getTokenDefinitions, getPoolById, getPoolBySubgraphId } from '@/lib/pools-config';
import { isFullRangePosition } from '@/lib/liquidity/hooks/range';
import { formatTickPriceForRange } from '@/lib/liquidity/utils/calculations/priceConversion';
import { useNetwork } from '@/lib/network-context';
import { cn } from "@/lib/utils";
import { MiniPoolChart } from './MiniPoolChart';
import { getOptimalBaseToken } from '@/lib/denomination-utils';
import { calculateRealizedApr, formatApr } from '@/lib/apr';
import { Percent } from '@uniswap/sdk-core';
import { ArrowUpRight } from 'lucide-react';
import { getPositionStatus, type PositionStatus, type PositionPointsData } from '@/types';
import {
    StatusIndicatorCircle,
    getPositionStatusLabel,
    getPositionStatusColor,
} from './LiquidityPositionStatusIndicator';
import { LiquidityPositionFeeStats, LiquidityPositionFeeStatsLoader } from './FeeStats';

/**
 * PositionCardCompactLoader
 *
 * Shimmer loading skeleton for PositionCardCompact.
 * Mirrors Uniswap's Shine pattern - single bar with shimmer effect.
 * Height matches actual card (~100px).
 */
export function PositionCardCompactLoader({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "h-[100px] rounded-lg bg-muted/40 animate-pulse",
                className
            )}
        />
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
    liquidityRaw?: string; // Raw liquidity amount for CLOSED status detection
    // Optimistic UI state - added dynamically during liquidity modifications
    isOptimisticallyUpdating?: boolean;
};

interface PositionCardCompactProps {
    position: ProcessedPosition;
    valueUSD: number;
    onClick: () => void;
    getUsdPriceForSymbol: (symbol?: string) => number;
    /** @deprecated No longer used - range prices computed directly from ticks */
    convertTickToPrice?: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
    poolType?: string;
    poolContext: {
        currentPrice: string | null;
        currentPoolTick: number | null;
        poolAPR: number | null;
        isLoadingPrices: boolean;
        isLoadingPoolStates: boolean;
    };
    fees: {
        raw0: string | null;
        raw1: string | null;
    };
    showMenuButton?: boolean;
    onVisitPool?: () => void;
    disableHover?: boolean;
    className?: string;
    /** Optional denomination base override. If provided and valid, uses this instead of auto-detection. */
    denominationBaseOverride?: string;
    /**
     * Optional points campaign data for this position.
     * Mirrors Uniswap's lpIncentiveRewardApr/totalApr pattern from LiquidityPositionFeeStats.
     * When provided and pointsApr > 0, displays PointsFeeStat instead of plain APR.
     */
    pointsData?: PositionPointsData;
}

export function PositionCardCompact({
    position,
    valueUSD,
    onClick,
    getUsdPriceForSymbol,
    poolType,
    poolContext,
    fees,
    showMenuButton = false,
    onVisitPool,
    denominationBaseOverride,
    disableHover = false,
    className,
    pointsData,
}: PositionCardCompactProps) {
    const [isHovered, setIsHovered] = useState(false);
    // Price inversion state for MinMaxRange toggle (mirrors Uniswap's pricesInverted)
    const [pricesInverted, setPricesInverted] = useState(false);
    const { networkMode } = useNetwork();
    const TOKEN_DEFINITIONS = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
    const { currentPrice, currentPoolTick, poolAPR, isLoadingPrices, isLoadingPoolStates } = poolContext;
    const { raw0: prefetchedRaw0, raw1: prefetchedRaw1 } = fees;

    // Calculate fees USD from raw fee amounts
    const { feesUSD, hasZeroFees } = React.useMemo(() => {
        if (prefetchedRaw0 === null || prefetchedRaw1 === null) {
            return { feesUSD: 0, hasZeroFees: false };
        }
        try {
            const raw0 = prefetchedRaw0 || '0';
            const raw1 = prefetchedRaw1 || '0';

            const d0 = TOKEN_DEFINITIONS?.[position.token0.symbol as string]?.decimals ?? 18;
            const d1 = TOKEN_DEFINITIONS?.[position.token1.symbol as string]?.decimals ?? 18;

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

    /**
     * Determine denomination base token.
     * Uses override if provided and valid, otherwise falls back to auto-detection.
     * Mirrors Uniswap's pricesInverted pattern from LiquidityPositionCard.
     */
    const denominationBase = React.useMemo(() => {
        // Use override if provided and matches one of the pool's tokens
        if (
            denominationBaseOverride &&
            (denominationBaseOverride === position.token0.symbol ||
             denominationBaseOverride === position.token1.symbol)
        ) {
            return denominationBaseOverride;
        }
        // Fall back to auto-detection based on token priority
        const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
        return getOptimalBaseToken(position.token0.symbol, position.token1.symbol, priceNum);
    }, [denominationBaseOverride, position.token0.symbol, position.token1.symbol, currentPrice]);

    // Combine denomination base with user toggle state
    // shouldInvert controls chart/current price, pricesInverted controls range display
    const shouldInvert = denominationBase === position.token0.symbol;

    // Formatted values for LiquidityPositionFeeStats (mirrors Uniswap pattern)
    const formattedUsdValue = React.useMemo(() => {
        if (!Number.isFinite(valueUSD)) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valueUSD);
    }, [valueUSD]);

    const formattedUsdFees = React.useMemo(() => {
        return `$${feesUSD.toFixed(2)}`;
    }, [feesUSD]);

    const displayedCurrentPrice = React.useMemo(() => {
        if (!currentPrice) return null;
        const priceNum = parseFloat(currentPrice);
        if (!isFinite(priceNum)) return null;
        return shouldInvert ? (1 / priceNum) : priceNum;
    }, [currentPrice, shouldInvert]);

    // Get tickSpacing from pool config for accurate full-range detection
    const tickSpacing = useMemo(() => {
        let poolConfig = getPoolById(position.poolId, networkMode);
        if (!poolConfig) {
            poolConfig = getPoolBySubgraphId(position.poolId, networkMode);
        }
        return poolConfig?.tickSpacing;
    }, [position.poolId, networkMode]);

    // Use centralized full-range detection (mirrors Uniswap's useIsTickAtLimit)
    const isFullRange = useMemo(() => {
        return isFullRangePosition(tickSpacing, position.tickLower, position.tickUpper);
    }, [tickSpacing, position.tickLower, position.tickUpper]);

    /**
     * Get token decimals for price calculation.
     * Mirrors Uniswap's approach of computing prices directly from ticks.
     */
    const { token0Decimals, token1Decimals } = useMemo(() => {
        const t0 = TOKEN_DEFINITIONS?.[position.token0.symbol];
        const t1 = TOKEN_DEFINITIONS?.[position.token1.symbol];
        return {
            token0Decimals: t0?.decimals ?? 18,
            token1Decimals: t1?.decimals ?? 18,
        };
    }, [TOKEN_DEFINITIONS, position.token0.symbol, position.token1.symbol]);

    /**
     * Format price range for display.
     * Mirrors Uniswap's useGetRangeDisplay / formatTickPrice pattern.
     *
     * Key insight: prices are computed directly from ticks using 1.0001^tick formula,
     * NOT relative to current pool price. This ensures range is always displayable.
     */
    const { minPrice, maxPrice } = React.useMemo(() => {
        // Check for invalid tick values (both 0 means data not loaded)
        if (position.tickLower === 0 && position.tickUpper === 0) {
            return { minPrice: '-', maxPrice: '-' };
        }

        // Use tickSpacing if found, otherwise fallback to 10
        const effectiveTickSpacing = tickSpacing ?? 10;

        // When inverted, swap which tick maps to which display slot
        // Lower display slot gets the tick that produces the lower price after inversion
        const tickForMin = shouldInvert ? position.tickUpper : position.tickLower;
        const tickForMax = shouldInvert ? position.tickLower : position.tickUpper;

        return {
            minPrice: formatTickPriceForRange(
                tickForMin,
                effectiveTickSpacing,
                true, // isLowerBound
                token0Decimals,
                token1Decimals,
                shouldInvert
            ),
            maxPrice: formatTickPriceForRange(
                tickForMax,
                effectiveTickSpacing,
                false, // isLowerBound
                token0Decimals,
                token1Decimals,
                shouldInvert
            ),
        };
    }, [tickSpacing, position.tickLower, position.tickUpper, position.positionId, token0Decimals, token1Decimals, shouldInvert]);

    /**
     * Derive position status from state.
     * Mirrors Uniswap's PositionStatus enum handling from lpStatusConfig.
     * Note: Calculated before APR since APR depends on status.
     */
    const positionStatus: PositionStatus = useMemo(() => {
        return getPositionStatus(position.isInRange, position.liquidityRaw);
    }, [position.isInRange, position.liquidityRaw]);

    // Calculate APR using fees, position value, lastTimestamp, and pool APR
    const { formattedAPR, isFallback: isAPRFallback, isLoading: isLoadingAPR } = React.useMemo(() => {
        if (isLoadingPrices || valueUSD <= 0) {
            return { formattedAPR: '-', isFallback: false, isLoading: true };
        }

        // Closed positions show 0% APR
        if (positionStatus === 'CLOSED') {
            return { formattedAPR: '0%', isFallback: false, isLoading: false };
        }

        // Out of range positions (non-full-range) show 0% APR
        if (positionStatus === 'OUT_OF_RANGE' && !isFullRange) {
            return { formattedAPR: '0%', isFallback: false, isLoading: false };
        }

        const nowTimestamp = Math.floor(Date.now() / 1000);
        const durationDays = (nowTimestamp - (position.lastTimestamp || position.blockTimestamp)) / 86400;

        // Convert poolAPR number to Percent for fallback
        const fallbackApr = poolAPR !== null && poolAPR !== undefined && isFinite(poolAPR)
            ? new Percent(Math.round(poolAPR * 100), 10000)
            : null;

        const result = calculateRealizedApr(feesUSD, valueUSD, durationDays, fallbackApr);
        return { formattedAPR: formatApr(result.apr), isFallback: result.isFallback, isLoading: false };
    }, [feesUSD, valueUSD, position.lastTimestamp, position.blockTimestamp, poolAPR, isLoadingPrices, positionStatus, isFullRange]);

    // Get display properties from status config
    const statusText = getPositionStatusLabel(positionStatus, isFullRange);
    const statusColor = getPositionStatusColor(positionStatus, isFullRange);

    return (
        <div
            className={cn(
                "relative flex flex-col rounded-lg border border-sidebar-border bg-muted/30 transition-colors",
                showMenuButton ? "overflow-visible" : "overflow-hidden",
                !disableHover && "cursor-pointer group",
                !disableHover && isHovered && "border-white/20",
                className
            )}
            onClick={disableHover ? undefined : onClick}
            onMouseEnter={() => !disableHover && setIsHovered(true)}
            onMouseLeave={() => !disableHover && setIsHovered(false)}
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
                <div className="flex lg:hidden w-[100px] sm:w-[120px] h-9 ml-auto cursor-pointer flex-shrink-0">
                    <MiniPoolChart
                        token0={position.token0.symbol}
                        token1={position.token1.symbol}
                        selectedPoolId={position.poolId}
                        denominationBase={denominationBase}
                        currentPrice={displayedCurrentPrice?.toString() || null}
                        minPrice={minPrice}
                        maxPrice={maxPrice}
                        isInRange={position.isInRange}
                        isFullRange={isFullRange}
                        className="w-full h-full"
                    />
                </div>
                <div className="hidden lg:flex flex-1 max-w-[200px] h-9 ml-auto cursor-pointer">
                    <MiniPoolChart
                        token0={position.token0.symbol}
                        token1={position.token1.symbol}
                        selectedPoolId={position.poolId}
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

            {/* BOTTOM SECTION - LiquidityPositionFeeStats (mirrors Uniswap architecture) */}
            <LiquidityPositionFeeStats
                // Value displays
                formattedUsdValue={formattedUsdValue}
                formattedUsdFees={formattedUsdFees}
                // APR data
                apr={poolAPR ?? undefined}
                formattedApr={formattedAPR}
                isAprFallback={isAPRFallback}
                // Points campaign
                pointsData={pointsData}
                // Token symbols
                token0Symbol={position.token0.symbol}
                token1Symbol={position.token1.symbol}
                // Card state
                cardHovered={isHovered}
                // Loading states
                isLoading={isLoadingPrices || prefetchedRaw0 === null || prefetchedRaw1 === null}
                isLoadingApr={isLoadingAPR}
                // Range props (mirrors LiquidityPositionMinMaxRangeProps)
                priceOrdering={undefined} // Using pre-formatted prices instead
                tickSpacing={tickSpacing}
                tickLower={position.tickLower}
                tickUpper={position.tickUpper}
                pricesInverted={pricesInverted}
                setPricesInverted={setPricesInverted}
                // Formatting context
                poolType={poolType}
                denominationBase={denominationBase}
                // Pre-formatted range values
                formattedMinPrice={minPrice}
                formattedMaxPrice={maxPrice}
                isFullRange={isFullRange}
            />
        </div>
    );
}
