"use client"

/**
 * UnifiedYieldPositionCard
 *
 * Dedicated card component for Unified Yield (ReHypothecation) positions.
 * Styled identically to PositionCardCompact for consistent UX.
 *
 * Key differences from V4 PositionCardCompact:
 * - Status always shows "Earning" (managed by Hook)
 * - Shows Yield chart instead of Price Range chart
 * - Range comes from pool config's rehypoRange (tick values)
 * - Shows Aave yield APR instead of swap APR
 * - No uncollected fees (yield accrued via aTokens)
 */

import React, { useState, useMemo } from 'react';
import { TokenStack } from "./TokenStack";
import { getPoolById, getToken } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { getOptimalBaseToken } from '@/lib/denomination-utils';
import { useQuery } from '@tanstack/react-query';
import { fetchAaveRates, getAaveKey } from '@/lib/aave-rates';
import { fetchUnifiedYieldPositionCompoundedFees } from '@/lib/backend-client';
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';
import {
    StatusIndicatorCircle,
    getPositionStatusColor,
} from './LiquidityPositionStatusIndicator';
import { LiquidityPositionFeeStats } from './FeeStats';
import type { UnifiedYieldPosition } from '@/lib/liquidity/unified-yield/types';

const PositionYieldChart = dynamic(
    () => import('./PositionYieldChart').then(mod => mod.PositionYieldChart),
    { ssr: false }
);

interface UnifiedYieldPositionCardProps {
    /** Unified Yield position data */
    position: UnifiedYieldPosition;
    /** Pre-calculated USD value of the position */
    valueUSD: number;
    /** Click handler for position navigation */
    onClick: () => void;
    /** Pool context for loading states and APR */
    poolContext: {
        currentPrice: string | null;
        isLoadingPrices: boolean;
        /** Pool swap APR (optional - for tooltip breakdown) */
        poolAPR?: number | null;
    };
    /** Additional CSS classes */
    className?: string;
}

export function UnifiedYieldPositionCard({
    position,
    valueUSD,
    onClick,
    poolContext,
    className,
}: UnifiedYieldPositionCardProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [pricesInverted, setPricesInverted] = useState(false);
    const { networkMode, chainId } = useNetwork();

    const { currentPrice, isLoadingPrices, poolAPR } = poolContext;

    // Token info directly from position
    const token0Symbol = position.token0Symbol;
    const token1Symbol = position.token1Symbol;

    // Get pool config
    const poolConfig = useMemo(() => {
        return getPoolById(position.poolId, networkMode);
    }, [position.poolId, networkMode]);

    // Get token configs for decimals
    const token0Config = useMemo(() => getToken(token0Symbol as any, networkMode), [token0Symbol, networkMode]);
    const token1Config = useMemo(() => getToken(token1Symbol as any, networkMode), [token1Symbol, networkMode]);

    // Fetch Aave rates for yield display
    const { data: aaveRatesData } = useQuery({
        queryKey: ['aaveRates'],
        queryFn: fetchAaveRates,
        staleTime: 5 * 60_000, // 5 minutes
    });

    // Fetch compounded fees from backend
    const { data: compoundedFeesData, isLoading: isLoadingCompoundedFees } = useQuery({
        queryKey: ['unifiedYieldCompoundedFees', position.hookAddress, position.userAddress, networkMode],
        queryFn: () => fetchUnifiedYieldPositionCompoundedFees(
            position.hookAddress,
            position.userAddress,
            networkMode
        ),
        staleTime: 5 * 60_000, // 5 minutes
    });

    // Calculate combined Aave APY
    const aaveApr = useMemo(() => {
        if (!aaveRatesData?.success) return undefined;

        const key0 = getAaveKey(token0Symbol);
        const key1 = getAaveKey(token1Symbol);

        const apy0 = key0 && aaveRatesData.data[key0] ? aaveRatesData.data[key0].apy : null;
        const apy1 = key1 && aaveRatesData.data[key1] ? aaveRatesData.data[key1].apy : null;

        if (apy0 !== null && apy1 !== null) {
            return (apy0 + apy1) / 2;
        }
        return apy0 ?? apy1 ?? undefined;
    }, [aaveRatesData, token0Symbol, token1Symbol]);

    // Determine denomination base
    const denominationBase = useMemo(() => {
        const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
        return getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
    }, [token0Symbol, token1Symbol, currentPrice]);

    // Parse tick values from pool config's rehypoRange
    const { isFullRange, tickLower, tickUpper } = useMemo(() => {
        const rehypoRange = poolConfig?.rehypoRange;
        if (!rehypoRange) {
            return { isFullRange: true, tickLower: undefined, tickUpper: undefined };
        }

        const isFullRangeVal = rehypoRange.isFullRange === true;
        if (isFullRangeVal) {
            return { isFullRange: true, tickLower: undefined, tickUpper: undefined };
        }

        // Parse tick values (rehypoRange.min/max are tick strings like "-276326")
        const tickLowerVal = parseInt(rehypoRange.min, 10);
        const tickUpperVal = parseInt(rehypoRange.max, 10);

        if (isNaN(tickLowerVal) || isNaN(tickUpperVal)) {
            return { isFullRange: true, tickLower: undefined, tickUpper: undefined };
        }

        return {
            isFullRange: false,
            tickLower: tickLowerVal,
            tickUpper: tickUpperVal,
        };
    }, [poolConfig?.rehypoRange]);

    // Use Uniswap SDK hooks for proper tick-to-price conversion (same as PositionCardCompact)
    const priceOrdering = usePriceOrdering({
        chainId: chainId ?? 8453,
        token0: {
            address: token0Config?.address || position.token0Address,
            symbol: token0Symbol,
            decimals: token0Config?.decimals ?? position.token0Decimals,
        },
        token1: {
            address: token1Config?.address || position.token1Address,
            symbol: token1Symbol,
            decimals: token1Config?.decimals ?? position.token1Decimals,
        },
        tickLower: tickLower ?? -887272, // MIN_TICK for full range
        tickUpper: tickUpper ?? 887272,  // MAX_TICK for full range
    });

    // Get formatted prices using Uniswap's useGetRangeDisplay
    const { minPrice, maxPrice } = useGetRangeDisplay({
        priceOrdering,
        pricesInverted,
        tickSpacing: poolConfig?.tickSpacing,
        tickLower: tickLower ?? -887272,
        tickUpper: tickUpper ?? 887272,
    });

    // Formatted USD value
    const formattedUsdValue = useMemo(() => {
        if (!Number.isFinite(valueUSD)) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valueUSD);
    }, [valueUSD]);

    // Formatted compounded fees
    const formattedCompoundedFees = useMemo(() => {
        if (!compoundedFeesData?.success || !Number.isFinite(compoundedFeesData.compoundedFeesUSD)) {
            return '$0.00';
        }
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(compoundedFeesData.compoundedFeesUSD);
    }, [compoundedFeesData]);

    // Format APR display
    const formattedApr = useMemo(() => {
        if (aaveApr === undefined || aaveApr === 0) return '0.00%';
        return `${aaveApr.toFixed(2)}%`;
    }, [aaveApr]);

    // Status text - Unified Yield positions always show "Earning"
    const statusText = 'Earning';

    // Status - always in range for Unified Yield
    const statusColor = getPositionStatusColor('IN_RANGE', isFullRange);

    // TokenStack-compatible object
    const tokenStackPosition = { token0: { symbol: token0Symbol }, token1: { symbol: token1Symbol } };

    return (
        <div
            className={cn(
                "relative flex flex-col rounded-lg border border-sidebar-border bg-muted/30 transition-colors overflow-hidden",
                "cursor-pointer group",
                isHovered && "border-white/20",
                className
            )}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Main content row - matches PositionCardCompact exactly */}
            <div className={cn(
                "relative flex items-center justify-between gap-4 py-3 sm:py-5 px-4 overflow-visible transition-colors",
                isHovered && "bg-muted/20"
            )}>
                {/* Token pair and status - identical to PositionCardCompact */}
                <div className="flex items-center gap-3 flex-shrink">
                    {isLoadingPrices ? (
                        <div className="h-8 w-16 bg-muted/60 rounded-full animate-pulse flex-shrink-0" />
                    ) : (
                        <div className="flex items-center flex-shrink-0 mr-2">
                            <TokenStack position={tokenStackPosition} />
                        </div>
                    )}
                    <div className="flex flex-col justify-center gap-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-normal whitespace-nowrap">{token0Symbol} / {token1Symbol}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={cn("flex items-center gap-1.5 text-xs", statusColor)}>
                                <StatusIndicatorCircle className={statusColor} />
                                <span>{statusText}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Yield chart - mobile */}
                <div className="flex lg:hidden w-[140px] sm:w-[160px] h-10 sm:h-12 ml-auto cursor-pointer flex-shrink-0">
                    <PositionYieldChart
                        poolId={poolConfig?.id || position.poolId}
                        token0Symbol={token0Symbol}
                        token1Symbol={token1Symbol}
                        yieldSources={poolConfig?.yieldSources}
                        className="w-full h-full"
                    />
                </div>

                {/* Yield chart - desktop */}
                <div className="hidden lg:flex flex-1 max-w-[280px] h-12 ml-auto cursor-pointer">
                    <PositionYieldChart
                        poolId={poolConfig?.id || position.poolId}
                        token0Symbol={token0Symbol}
                        token1Symbol={token1Symbol}
                        yieldSources={poolConfig?.yieldSources}
                        className="w-full h-full"
                    />
                </div>
            </div>

            {/* Stats row - use LiquidityPositionFeeStats for consistency */}
            <LiquidityPositionFeeStats
                formattedUsdValue={formattedUsdValue}
                formattedUsdFees={formattedCompoundedFees}
                feesLabel="Compounded Fees"
                hideRangeContent
                token0Amount={position.token0Amount}
                token1Amount={position.token1Amount}
                apr={poolAPR ?? undefined}
                formattedApr={formattedApr}
                isAprFallback={false}
                unifiedYieldApr={aaveApr}
                pointsData={undefined}
                token0Symbol={token0Symbol}
                token1Symbol={token1Symbol}
                cardHovered={isHovered}
                isLoading={isLoadingPrices || isLoadingCompoundedFees}
                isLoadingApr={!aaveRatesData}
                tickSpacing={poolConfig?.tickSpacing}
                tickLower={tickLower}
                tickUpper={tickUpper}
                pricesInverted={pricesInverted}
                setPricesInverted={setPricesInverted}
                poolType={poolConfig?.type}
                denominationBase={denominationBase}
                formattedMinPrice={isFullRange ? '0' : minPrice}
                formattedMaxPrice={isFullRange ? '∞' : maxPrice}
                isFullRange={isFullRange}
            />
        </div>
    );
}
