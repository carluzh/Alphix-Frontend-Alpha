"use client"

import React, { useState } from 'react';
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Clock3, ChevronsLeftRight, EllipsisVertical } from "lucide-react";
import { TokenStack } from "./TokenStack";
import { FeesCell } from "./FeesCell";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken as getTokenConfig } from '@/lib/pools-config';

import { cn } from "@/lib/utils";

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

interface PositionCardProps {
    position: ProcessedPosition;
    valueUSD: number;
    poolKey: string;
    getUsdPriceForSymbol: (symbol?: string) => number;
    determineBaseTokenForPriceDisplay: (token0: string, token1: string) => string;
    convertTickToPrice: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
    poolDataByPoolId: Record<string, any>;
    formatTokenDisplayAmount: (amount: string) => string;
    formatAgeShort: (seconds: number | undefined) => string;
    openWithdraw: (position: any) => void;
    openAddLiquidity: (position: any) => void;
    claimFees: (positionId: string) => Promise<void>;
    toast: any;
    openPositionMenuKey: string | null;
    setOpenPositionMenuKey: (key: string | null) => void;
    positionMenuOpenUp: boolean;
    setPositionMenuOpenUp: (val: boolean) => void;
    onClick: () => void;
    isLoadingPrices: boolean;
    isLoadingPoolStates: boolean;
}

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;

export function PositionCard({
    position,
    valueUSD,
    poolKey,
    getUsdPriceForSymbol,
    determineBaseTokenForPriceDisplay,
    convertTickToPrice,
    poolDataByPoolId,
    formatTokenDisplayAmount,
    formatAgeShort,
    openWithdraw,
    openAddLiquidity,
    claimFees,
    toast,
    openPositionMenuKey,
    setOpenPositionMenuKey,
    positionMenuOpenUp,
    setPositionMenuOpenUp,
    onClick,
    isLoadingPrices,
    isLoadingPoolStates,
}: PositionCardProps) {
    const [isHoverDisabled, setIsHoverDisabled] = useState(false);

    const handleChildEnter = () => setIsHoverDisabled(true);
    const handleChildLeave = () => setIsHoverDisabled(false);
    const handleChildClick = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <Card
            key={position.positionId}
            className={cn(
                "bg-muted/30 border border-sidebar-border/60 transition-colors group cursor-pointer",
                !isHoverDisabled && "hover:border-sidebar-border"
            )}
            onClick={onClick}
        >
            <CardContent className="p-3 sm:p-4 group">
            <div
                className="grid sm:items-center"
                style={{
                gridTemplateColumns: 'min-content max-content max-content 1fr 5.5rem',
                columnGap: '1.25rem',
                }}
            >
            {/* Column 1: Token Icons - Very narrow */}
            <div className="flex items-center min-w-0 flex-none gap-0">
                {isLoadingPrices || isLoadingPoolStates ? <div className="h-6 w-10 bg-muted/60 rounded-full animate-pulse" /> : <TokenStack position={position as any} />}
            </div>

            {/* Column 2: Position Value - left-bound, size-to-content */}
            <div className="flex items-start pr-2">
                <div className="flex flex-col gap-1 items-start">
                <div className="text-xs text-muted-foreground">Position Value</div>
                <div className="flex items-center gap-2 truncate">
                    {isLoadingPrices ? <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" /> : (
                      <div className="text-xs font-medium truncate">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(valueUSD) ? valueUSD : 0)}
                      </div>
                    )}
                </div>
                </div>
            </div>

            {/* Column 3: Fees - left-bound, size-to-content */}
            <div className="flex items-start pr-2" onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave} onClick={handleChildClick}>
                <div className="flex flex-col gap-1 items-start">
                <div className="flex items-center gap-1">
                    <div className="text-xs text-muted-foreground">Fees</div>
                    <TooltipProvider delayDuration={0}>
                        <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs max-w-48">
                            <p>Unclaimed Fees</p>
                        </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <FeesCell
                      positionId={position.positionId}
                      sym0={position.token0.symbol || 'T0'}
                      sym1={position.token1.symbol || 'T1'}
                      price0={getUsdPriceForSymbol(position.token0.symbol)}
                      price1={getUsdPriceForSymbol(position.token1.symbol)}
                      prefetchedRaw0={(position as any)?.unclaimedRaw0}
                      prefetchedRaw1={(position as any)?.unclaimedRaw1}
                    />
                </div>
                </div>
            </div>

            {/* Column 4: Flexible spacer to push Withdraw; absorbs surplus width */}
            <div />

            {/* Column 5: Actions - Static Withdraw button */}
            <div className="flex items-center justify-end gap-2 w-[5.5rem] flex-none" onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave} onClick={handleChildClick}>
                <button
                onClick={(e) => {
                    e.stopPropagation();
                    openWithdraw(position);
                }}
                className="flex h-7 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-2 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                Withdraw
                </button>
            </div>
            </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between py-1.5 px-3 bg-muted/10 border-t border-sidebar-border/30 group/subbar">
            <div className="flex items-center text-xs text-muted-foreground gap-3">
                <div onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave}>
                    <TooltipProvider delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                        <span className="font-mono tabular-nums flex items-center gap-1.5 cursor-default">
                            <ChevronsLeftRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                            {isLoadingPoolStates ? <div className="h-4 w-24 bg-muted/60 rounded animate-pulse" /> : (() => {
                                const baseToken = determineBaseTokenForPriceDisplay(position.token0.symbol, position.token1.symbol);
                                const pool = poolDataByPoolId[poolKey] || poolDataByPoolId[String(position.poolId || '').toLowerCase()] || {};
                                const currentPriceStr = pool?.price ? String(pool.price) : null;
                                const tickNow = typeof pool?.tick === 'number' ? pool.tick : null;
                                const minPrice = convertTickToPrice(position.tickLower, tickNow, currentPriceStr, baseToken, position.token0.symbol, position.token1.symbol);
                                const maxPrice = convertTickToPrice(position.tickUpper, tickNow, currentPriceStr, baseToken, position.token0.symbol, position.token1.symbol);
                                return `${minPrice} - ${maxPrice}`;
                            })()}
                        </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                        <div className="font-medium text-foreground">Liquidity Range</div>
                        </TooltipContent>
                    </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="w-px h-3 bg-border"></div>
                <div onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave}>
                    <TooltipProvider delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                        <span className="font-mono tabular-nums flex items-center gap-1.5 cursor-default">
                            <Clock3 className="h-2.5 w-2.5 text-muted-foreground" aria-hidden />
                            {formatAgeShort(position.ageSeconds)}
                        </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                        <div className="font-medium text-foreground">Position Age</div>
                        </TooltipContent>
                    </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
            
            <div className="flex items-center gap-1.5">
                <div>
                    {(() => {
                        const isFullRange = position.tickLower === SDK_MIN_TICK && position.tickUpper === SDK_MAX_TICK;
                        const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
                        const statusColor = position.isInRange || isFullRange ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500';

                        return (
                            <div className={`flex items-center justify-center h-4 rounded-md px-1.5 text-[10px] leading-none ${statusColor}`}>
                                {statusText}
                            </div>
                        );
                    })()}
                </div>

                <div className="relative position-card-menu-trigger" onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave} onClick={handleChildClick}>
                    <Button
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground/70 group-hover/subbar:text-white leading-none flex items-center justify-center"
                        onClick={(e) => {
                            e.stopPropagation();
                            const next = openPositionMenuKey === position.positionId ? null : position.positionId;
                            setOpenPositionMenuKey(next);
                            if (next) {
                                const trigger = (e.currentTarget as HTMLElement);
                                const rect = trigger.getBoundingClientRect();
                                const approxMenuHeight = 128; // ~3 items + padding
                                const wouldOverflow = rect.bottom + approxMenuHeight > window.innerHeight - 8;
                                setPositionMenuOpenUp(wouldOverflow);
                            }
                        }}
                    >
                        <span className="sr-only">Open menu</span>
                        <EllipsisVertical className="h-3 w-3 block" />
                    </Button>
                    <AnimatePresence>
                        {openPositionMenuKey === position.positionId && (
                        <motion.div
                            initial={{ opacity: 0, y: positionMenuOpenUp ? 6 : -6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: positionMenuOpenUp ? 6 : -6, scale: 0.98 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.6 }}
                            className="absolute z-[100] right-0 w-max min-w-[140px] rounded-md border border-sidebar-border bg-[var(--modal-background)] shadow-md overflow-hidden position-card-menu-content"
                            style={{
                            marginTop: positionMenuOpenUp ? undefined : 4,
                            bottom: positionMenuOpenUp ? '100%' : undefined,
                            marginBottom: positionMenuOpenUp ? 4 : undefined,
                            transformOrigin: positionMenuOpenUp ? 'bottom right' : 'top right',
                            willChange: 'transform, opacity',
                            }}
                        >
                            <div className="p-1 grid gap-1">
                            <button type="button" className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30" onClick={(e) => { e.stopPropagation(); openAddLiquidity(position); setOpenPositionMenuKey(null); }}>Add Liquidity</button>
                            <button type="button" className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30" onClick={async (e) => { e.stopPropagation(); setOpenPositionMenuKey(null); try { await claimFees(position.positionId); } catch (err: any) { toast.error('Collect failed', { description: err?.message }); } }}>Claim Fees</button>
                            </div>
                        </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            </CardFooter>
        </Card>
    );
}
