"use client"

import React, { useState, useMemo } from 'react';
import Image from "next/image";
import { TokenStack } from "./TokenStack";
import { getPoolById } from '@/lib/pools-config';
import { isFullRangePosition } from '@/lib/liquidity/hooks/range';
import { usePriceOrdering, useGetRangeDisplay, type PositionInfo } from '@/lib/uniswap/liquidity';
import { PositionStatus } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb';
import { useNetwork } from '@/lib/network-context';
import { cn } from "@/lib/utils";
import { PositionRangeChart } from './PositionRangeChart';
import { getOptimalBaseToken } from '@/lib/denomination-utils';
import { calculateRealizedApr, formatApr } from '@/lib/apr';
import { Percent } from '@uniswap/sdk-core';
import { ArrowUpRight } from 'lucide-react';
import { type PositionPointsData } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { fetchAaveRates, getAaveKey } from '@/lib/aave-rates';
import { fetchPositionApr } from '@/lib/backend-client';
import {
    StatusIndicatorCircle,
    getPositionStatusLabel,
    getPositionStatusColor,
} from './LiquidityPositionStatusIndicator';
import { LiquidityPositionFeeStats } from './FeeStats';
import { useUSDCValue } from '@/lib/uniswap/hooks/useUSDCPrice';

/**
 * PositionCardCompactLoader - Shimmer skeleton for position cards
 */
export function PositionCardCompactLoader({ className }: { className?: string }) {
    return (
        <div className={cn("h-[100px] rounded-lg bg-muted/40 animate-pulse", className)} />
    );
}

interface PositionCardCompactProps {
    /** Position data - Uniswap SDK PositionInfo from parseSubgraphPosition */
    position: PositionInfo;
    /** Pre-calculated USD value of the position */
    valueUSD: number;
    onClick: () => void;
    poolType?: string;
    poolContext: {
        currentPrice: string | null;
        currentPoolTick: number | null;
        poolAPR: number | null;
        isLoadingPrices: boolean;
        isLoadingPoolStates: boolean;
    };
    showMenuButton?: boolean;
    onVisitPool?: () => void;
    disableHover?: boolean;
    className?: string;
    denominationBaseOverride?: string;
    pointsData?: PositionPointsData;
    /** Optimistic UI state */
    isOptimisticallyUpdating?: boolean;
    /** Position timestamps for APR calculation */
    blockTimestamp?: number;
    lastTimestamp?: number;
}

export function PositionCardCompact({
    position,
    valueUSD,
    onClick,
    poolType,
    poolContext,
    showMenuButton = false,
    onVisitPool,
    denominationBaseOverride,
    disableHover = false,
    className,
    pointsData,
    isOptimisticallyUpdating,
    blockTimestamp,
    lastTimestamp,
}: PositionCardCompactProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [pricesInverted, setPricesInverted] = useState(false);
    const { networkMode, chainId } = useNetwork();

    // Extract token info from SDK CurrencyAmount objects
    const token0 = position.currency0Amount.currency;
    const token1 = position.currency1Amount.currency;
    const token0Symbol = token0.symbol ?? 'TOKEN0';
    const token1Symbol = token1.symbol ?? 'TOKEN1';
    const token0Decimals = token0.decimals;
    const token1Decimals = token1.decimals;
    const token0Address = token0.isNative ? '0x0000000000000000000000000000000000000000' : (token0 as any).address;
    const token1Address = token1.isNative ? '0x0000000000000000000000000000000000000000' : (token1 as any).address;

    const { currentPrice, poolAPR, isLoadingPrices, isLoadingPoolStates } = poolContext;

    // Fetch Aave rates for Unified Yield display
    const { data: aaveRatesData } = useQuery({
        queryKey: ['aaveRates'],
        queryFn: fetchAaveRates,
        staleTime: 5 * 60_000, // 5 minutes
    });

    // Fetch position-specific 7d APR from backend
    const positionId = position.tokenId?.toString();
    const { data: backendAprData, isLoading: isLoadingBackendApr } = useQuery({
        queryKey: ['positionApr', positionId],
        queryFn: () => fetchPositionApr(positionId!),
        enabled: !!positionId && position.status !== PositionStatus.CLOSED,
        staleTime: 5 * 60_000, // 5 minutes
    });

    // Calculate Aave APY based on position tokens
    const unifiedYieldApr = useMemo(() => {
        if (!aaveRatesData?.success) return undefined;

        const key0 = getAaveKey(token0Symbol);
        const key1 = getAaveKey(token1Symbol);

        const apy0 = key0 && aaveRatesData.data[key0] ? aaveRatesData.data[key0].apy : null;
        const apy1 = key1 && aaveRatesData.data[key1] ? aaveRatesData.data[key1].apy : null;

        // Average if both tokens supported, otherwise use single token's APY
        if (apy0 !== null && apy1 !== null) {
            return (apy0 + apy1) / 2;
        }
        return apy0 ?? apy1 ?? undefined;
    }, [aaveRatesData, token0Symbol, token1Symbol]);

    // Get USD values for fees using Uniswap's routing-based pricing
    // This fixes the bug where tokens not in priceMap returned $0
    const fee0USD = useUSDCValue(position.fee0Amount);
    const fee1USD = useUSDCValue(position.fee1Amount);

    // Calculate fees USD from Uniswap routing prices
    const { feesUSD, hasZeroFees } = useMemo(() => {
        const fee0Amount = position.fee0Amount;
        const fee1Amount = position.fee1Amount;

        if (!fee0Amount || !fee1Amount) {
            return { feesUSD: 0, hasZeroFees: true };
        }

        try {
            const fee0 = parseFloat(fee0Amount.toExact());
            const fee1 = parseFloat(fee1Amount.toExact());

            // Use USD values from useUSDCValue hook (routing-based pricing)
            const fee0UsdValue = fee0USD ? parseFloat(fee0USD.toExact()) : 0;
            const fee1UsdValue = fee1USD ? parseFloat(fee1USD.toExact()) : 0;
            const usdFees = fee0UsdValue + fee1UsdValue;

            return { feesUSD: usdFees, hasZeroFees: fee0 <= 0 && fee1 <= 0 };
        } catch {
            return { feesUSD: 0, hasZeroFees: true };
        }
    }, [position.fee0Amount, position.fee1Amount, fee0USD, fee1USD]);

    // Determine denomination base token
    const denominationBase = useMemo(() => {
        if (denominationBaseOverride && (denominationBaseOverride === token0Symbol || denominationBaseOverride === token1Symbol)) {
            return denominationBaseOverride;
        }
        const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
        return getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
    }, [denominationBaseOverride, token0Symbol, token1Symbol, currentPrice]);

    const shouldInvert = denominationBase === token0Symbol;

    // Formatted values for display
    const formattedUsdValue = useMemo(() => {
        if (!Number.isFinite(valueUSD)) return '-';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valueUSD);
    }, [valueUSD]);

    const formattedUsdFees = useMemo(() => `$${feesUSD.toFixed(2)}`, [feesUSD]);

    const displayedCurrentPrice = useMemo(() => {
        if (!currentPrice) return null;
        const priceNum = parseFloat(currentPrice);
        if (!isFinite(priceNum)) return null;
        return shouldInvert ? (1 / priceNum) : priceNum;
    }, [currentPrice, shouldInvert]);

    // Get tickSpacing from position or pool config
    const tickSpacing = useMemo(() => {
        if (position.tickSpacing) return position.tickSpacing;
        const poolConfig = getPoolById(position.poolId, networkMode);
        return poolConfig?.tickSpacing;
    }, [position.poolId, position.tickSpacing, networkMode]);

    // Full-range detection
    const isFullRange = useMemo(() => {
        return isFullRangePosition(tickSpacing, position.tickLower, position.tickUpper);
    }, [tickSpacing, position.tickLower, position.tickUpper]);

    // Get PriceOrdering from position using Uniswap SDK
    const priceOrdering = usePriceOrdering({
        chainId,
        token0: { address: token0Address, symbol: token0Symbol, decimals: token0Decimals },
        token1: { address: token1Address, symbol: token1Symbol, decimals: token1Decimals },
        tickLower: position.tickLower!,
        tickUpper: position.tickUpper!,
    });

    // Use Uniswap's useGetRangeDisplay for price formatting
    const { minPrice, maxPrice } = useGetRangeDisplay({
        priceOrdering,
        pricesInverted,
        tickSpacing,
        tickLower: position.tickLower!,
        tickUpper: position.tickUpper!,
    });

    // Map SDK PositionStatus to local string type
    const positionStatusString = useMemo(() => {
        switch (position.status) {
            case PositionStatus.IN_RANGE: return 'IN_RANGE' as const;
            case PositionStatus.OUT_OF_RANGE: return 'OUT_OF_RANGE' as const;
            case PositionStatus.CLOSED: return 'CLOSED' as const;
            default: return 'OUT_OF_RANGE' as const;
        }
    }, [position.status]);

    const isInRange = position.status === PositionStatus.IN_RANGE;

    // Calculate APR - prefer backend 7d APR, fallback to local calculation
    const { formattedAPR, rawSwapApr, isFallback: isAPRFallback, isLoading: isLoadingAPR } = useMemo(() => {
        // Still loading
        if (isLoadingPrices || isLoadingBackendApr) {
            return { formattedAPR: '-', rawSwapApr: undefined, isFallback: false, isLoading: true };
        }

        if (valueUSD <= 0) {
            return { formattedAPR: '-', rawSwapApr: undefined, isFallback: false, isLoading: false };
        }

        if (position.status === PositionStatus.CLOSED) {
            return { formattedAPR: '0%', rawSwapApr: 0, isFallback: false, isLoading: false };
        }

        if (position.status === PositionStatus.OUT_OF_RANGE && !isFullRange) {
            return { formattedAPR: '0%', rawSwapApr: 0, isFallback: false, isLoading: false };
        }

        // Use backend APR if available and has data
        if (backendAprData?.success && backendAprData.apr7d !== null && backendAprData.dataPoints > 0) {
            // apr7d is already a percentage value (e.g., 1.826 = 1.826%)
            return {
                formattedAPR: backendAprData.apr7dPercent ?? `${backendAprData.apr7d.toFixed(2)}%`,
                rawSwapApr: backendAprData.apr7d,
                isFallback: false,
                isLoading: false,
            };
        }

        // Fallback to local calculation
        const nowTimestamp = Math.floor(Date.now() / 1000);
        const positionTimestamp = lastTimestamp || blockTimestamp || nowTimestamp;
        const durationDays = (nowTimestamp - positionTimestamp) / 86400;

        const fallbackApr = poolAPR !== null && poolAPR !== undefined && isFinite(poolAPR)
            ? new Percent(Math.round(poolAPR * 100), 10000)
            : null;

        const result = calculateRealizedApr(feesUSD, valueUSD, durationDays, fallbackApr);

        // Extract raw APR value for tooltip breakdown
        let aprValue: number | undefined = undefined;
        if (result.apr) {
            aprValue = parseFloat(result.apr.toFixed(2));
        }

        return {
            formattedAPR: formatApr(result.apr),
            rawSwapApr: aprValue,
            isFallback: result.isFallback,
            isLoading: false,
        };
    }, [feesUSD, valueUSD, lastTimestamp, blockTimestamp, poolAPR, isLoadingPrices, isLoadingBackendApr, position.status, isFullRange, backendAprData]);

    // Status display
    const statusText = getPositionStatusLabel(positionStatusString, isFullRange);
    const statusColor = getPositionStatusColor(positionStatusString, isFullRange);

    // TokenStack-compatible position object
    const tokenStackPosition = { token0: { symbol: token0Symbol }, token1: { symbol: token1Symbol } };

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
            {isOptimisticallyUpdating && (
                <div className="absolute inset-0 bg-muted/20 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                    <Image src="/LogoIconWhite.svg" alt="Updating..." width={24} height={24} className="animate-pulse opacity-75" />
                </div>
            )}

            <div className={cn(
                "relative flex items-center justify-between gap-4 py-5 px-4 overflow-visible transition-colors",
                isHovered && "bg-muted/20"
            )}>
                <div className="flex items-center gap-3 min-w-0 flex-shrink">
                    {isLoadingPrices || isLoadingPoolStates ? (
                        <div className="h-8 w-16 bg-muted/60 rounded-full animate-pulse flex-shrink-0" />
                    ) : (
                        <div className="flex items-center flex-shrink-0 mr-2">
                            <TokenStack position={tokenStackPosition} />
                        </div>
                    )}
                    <div className="flex flex-col justify-center gap-0.5 min-w-0">
                        <div className="text-sm font-normal">{token0Symbol} / {token1Symbol}</div>
                        <div className="flex items-center gap-2">
                            <div className={cn("flex items-center gap-1.5 text-xs", statusColor)}>
                                <StatusIndicatorCircle className={statusColor} />
                                <span>{statusText}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex lg:hidden w-[140px] sm:w-[160px] h-12 ml-auto cursor-pointer flex-shrink-0">
                    <PositionRangeChart
                        poolId={position.poolId}
                        token0={token0Symbol}
                        token1={token1Symbol}
                        priceInverted={pricesInverted}
                        positionStatus={position.status}
                        priceLower={minPrice ? parseFloat(minPrice) : undefined}
                        priceUpper={maxPrice ? parseFloat(maxPrice) : undefined}
                        className="w-full h-full"
                    />
                </div>
                <div className="hidden lg:flex flex-1 max-w-[280px] h-12 ml-auto cursor-pointer">
                    <PositionRangeChart
                        poolId={position.poolId}
                        token0={token0Symbol}
                        token1={token1Symbol}
                        priceInverted={pricesInverted}
                        positionStatus={position.status}
                        priceLower={minPrice ? parseFloat(minPrice) : undefined}
                        priceUpper={maxPrice ? parseFloat(maxPrice) : undefined}
                        className="w-full h-full"
                    />
                </div>

                {showMenuButton && isHovered && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onVisitPool?.(); }}
                        className="absolute top-2 right-2 p-1.5 rounded bg-muted/60 hover:bg-muted transition-all z-10"
                    >
                        <ArrowUpRight className="h-4 w-4" />
                    </button>
                )}
            </div>

            <LiquidityPositionFeeStats
                formattedUsdValue={formattedUsdValue}
                formattedUsdFees={formattedUsdFees}
                apr={rawSwapApr}
                formattedApr={formattedAPR}
                isAprFallback={isAPRFallback}
                unifiedYieldApr={unifiedYieldApr}
                pointsData={pointsData}
                token0Symbol={token0Symbol}
                token1Symbol={token1Symbol}
                cardHovered={isHovered}
                isLoading={isLoadingPrices || !position.fee0Amount}
                isLoadingApr={isLoadingAPR}
                tickSpacing={tickSpacing}
                tickLower={position.tickLower!}
                tickUpper={position.tickUpper!}
                pricesInverted={pricesInverted}
                setPricesInverted={setPricesInverted}
                poolType={poolType}
                denominationBase={denominationBase}
                formattedMinPrice={minPrice}
                formattedMaxPrice={maxPrice}
                isFullRange={isFullRange}
            />
        </div>
    );
}
