"use client";

/**
 * Position Card with Nested Modals Integration
 *
 * This component demonstrates the complete flow:
 * 1. Compact Position Card
 * 2. Position Details Modal (on card click)
 * 3. Nested Add Liquidity / Withdraw Modals (side-by-side on desktop, stacked on mobile)
 *
 * Usage:
 * Replace your existing PositionCard with this component
 */

import React, { useState } from 'react';
import { PositionCardCompact } from './PositionCardCompact';
import { PositionDetailsModal } from './PositionDetailsModal';
import { NestedModalManager, useNestedModal } from './NestedModalManager';
import { OctagonX } from 'lucide-react';

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
    lastTimestamp: number;
};

interface PositionCardWithModalsProps {
    position: ProcessedPosition;
    valueUSD: number;
    poolKey: string;
    getUsdPriceForSymbol: (symbol?: string) => number;
    convertTickToPrice: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
    poolDataByPoolId: Record<string, any>;
    formatTokenDisplayAmount: (amount: string) => string;
    formatAgeShort: (seconds: number | undefined) => string;
    openWithdraw: (position: any) => void;
    openAddLiquidity: (position: any, onModalClose?: () => void) => void;
    claimFees: (positionId: string) => Promise<void>;
    toast: any;
    isLoadingPrices: boolean;
    isLoadingPoolStates: boolean;
    currentPrice?: string | null;
    currentPoolTick?: number | null;
    currentPoolSqrtPriceX96?: string | null;
    poolLiquidity?: string | null;
    prefetchedRaw0?: string | null;
    prefetchedRaw1?: string | null;
    chainId?: number;
    poolAPY?: number | null;
}

export function PositionCardWithModals(props: PositionCardWithModalsProps) {
    const {
        position,
        valueUSD,
        poolKey,
        getUsdPriceForSymbol,
        convertTickToPrice,
        formatTokenDisplayAmount,
        claimFees,
        toast,
        isLoadingPrices,
        isLoadingPoolStates,
        currentPrice,
        currentPoolTick,
        currentPoolSqrtPriceX96,
        poolLiquidity,
        prefetchedRaw0,
        prefetchedRaw1,
        chainId,
        openWithdraw,
        openAddLiquidity,
        poolAPY
    } = props;

    // Modal state
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const nestedModal = useNestedModal();

    // Calculate fees for modal
    const hasZeroFees = React.useMemo(() => {
        if (prefetchedRaw0 === null || prefetchedRaw1 === null) return false;
        try {
            const raw0 = prefetchedRaw0 || '0';
            const raw1 = prefetchedRaw1 || '0';
            return BigInt(raw0) <= 0n && BigInt(raw1) <= 0n;
        } catch {
            return false;
        }
    }, [prefetchedRaw0, prefetchedRaw1]);

    // Handlers
    const handleCardClick = () => {
        setIsDetailsModalOpen(true);
    };

    const handleCloseDetailsModal = () => {
        setIsDetailsModalOpen(false);
        nestedModal.closeAll();
    };

    const handleAddLiquidity = () => {
        // Close position details modal and open Add Liquidity modal
        setIsDetailsModalOpen(false);
        openAddLiquidity(position);
    };

    const handleWithdraw = () => {
        // Close position details modal and open Withdraw modal
        setIsDetailsModalOpen(false);
        openWithdraw(position);
    };

    const handleClaimFees = async () => {
        if (hasZeroFees) {
            toast.error('No Fees Available', {
                icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
                description: 'This position has no fees to claim.',
                duration: 4000
            });
            return;
        }

        try {
            await claimFees(position.positionId);
            toast.success('Fees Claimed', {
                description: 'Your fees have been successfully claimed.',
                duration: 4000
            });
            setIsDetailsModalOpen(false);
        } catch (err: any) {
            toast.error('Claim Failed', {
                icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
                description: err?.message || 'Failed to claim fees.',
                action: {
                    label: "Copy Error",
                    onClick: () => navigator.clipboard.writeText(err?.message || 'Failed to claim fees')
                }
            });
        }
    };

    // APR calculation (passed to modal)
    const [apr, setApr] = useState<number | null>(null);
    const [isLoadingAPR, setIsLoadingAPR] = useState(false);

    // Denomination data from PositionCardCompact
    const [denominationData, setDenominationData] = useState<{
        denominationBase: string;
        minPrice: string;
        maxPrice: string;
        displayedCurrentPrice: string | null;
        feesUSD: number;
        formattedAPY: string;
        isAPYFallback: boolean;
        isLoadingAPY: boolean;
    } | null>(null);

    return (
        <>
            {/* Compact Position Card */}
            <PositionCardCompact
                position={position}
                valueUSD={valueUSD}
                getUsdPriceForSymbol={getUsdPriceForSymbol}
                convertTickToPrice={convertTickToPrice}
                onClick={handleCardClick}
                poolContext={{
                    currentPrice: currentPrice ?? null,
                    currentPoolTick: currentPoolTick ?? null,
                    poolAPY: poolAPY ?? null,
                    isLoadingPrices,
                    isLoadingPoolStates
                }}
                fees={{
                    raw0: prefetchedRaw0 ?? null,
                    raw1: prefetchedRaw1 ?? null
                }}
                onDenominationData={setDenominationData}
            />

            {/* Position Details Modal */}
            <PositionDetailsModal
                isOpen={isDetailsModalOpen}
                onClose={handleCloseDetailsModal}
                position={position}
                valueUSD={valueUSD}
                prefetchedRaw0={prefetchedRaw0}
                prefetchedRaw1={prefetchedRaw1}
                formatTokenDisplayAmount={formatTokenDisplayAmount}
                getUsdPriceForSymbol={getUsdPriceForSymbol}
                onRefreshPosition={() => {
                    // This component is deprecated - stub implementation
                    console.warn('PositionCardWithModals is deprecated, use PositionCardCompact with PositionDetailsModal');
                }}
                currentPrice={currentPrice}
                currentPoolTick={currentPoolTick}
                convertTickToPrice={convertTickToPrice}
                apr={apr}
                isLoadingAPR={isLoadingAPR}
                selectedPoolId={position.poolId}
                chainId={chainId}
                currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                denominationBase={denominationData?.denominationBase}
                initialMinPrice={denominationData?.minPrice}
                initialMaxPrice={denominationData?.maxPrice}
                initialCurrentPrice={denominationData?.displayedCurrentPrice}
                prefetchedFormattedAPY={denominationData?.formattedAPY}
                prefetchedIsAPYFallback={denominationData?.isAPYFallback}
                prefetchedIsLoadingAPY={denominationData?.isLoadingAPY}
            />
        </>
    );
}
