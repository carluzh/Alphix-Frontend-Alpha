"use client"

import React, { useState } from 'react';
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits } from "viem";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Clock3, ChevronsLeftRight, EllipsisVertical, OctagonX } from "lucide-react";
import { TokenStack } from "./TokenStack";
import { FeesCell } from "./FeesCell";
import { PositionRangePreview } from "./PositionRangePreview";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken as getTokenConfig } from '@/lib/pools-config';
import { nearestUsableTick } from '@uniswap/v3-sdk';

import { cn } from "@/lib/utils";

// Status indicator circle component inspired by Uniswap
function StatusIndicatorCircle({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={className}>
      <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4" />
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

// Helper function to determine base token for price display (same logic as pool page)
const determineBaseTokenForPriceDisplay = (token0: string, token1: string): string => {
  if (!token0 || !token1) return token0;

  // Priority order for quote tokens (these should be the base for price display)
  const quotePriority: Record<string, number> = {
    'aUSDC': 10,
    'aUSDT': 9,
    'USDC': 8,
    'USDT': 7,
    'aETH': 6,
    'ETH': 5,
    'YUSD': 4,
    'mUSDT': 3,
  };

  const token0Priority = quotePriority[token0] || 0;
  const token1Priority = quotePriority[token1] || 0;

  // Return the token with higher priority (better quote currency)
  // If priorities are equal, default to token0
  return token1Priority > token0Priority ? token1 : token0;
};

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
    openAddLiquidity: (position: any, onModalClose?: () => void) => void;
    claimFees: (positionId: string) => Promise<void>;
    toast: any;
    openPositionMenuKey: string | null;
    setOpenPositionMenuKey: (key: string | null) => void;
    positionMenuOpenUp: boolean;
    setPositionMenuOpenUp: (val: boolean) => void;
    onClick: () => void;
    isLoadingPrices: boolean;
    isLoadingPoolStates: boolean;
    // New props for ascending range logic
    currentPrice?: string | null;
    currentPoolTick?: number | null;
    // Prefetched fee data to avoid loading states
    prefetchedRaw0?: string | null;
    prefetchedRaw1?: string | null;
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
    currentPrice,
    currentPoolTick,
    prefetchedRaw0,
    prefetchedRaw1,
}: PositionCardProps) {
    const [isHoverDisabled, setIsHoverDisabled] = useState(false);
    const [isPositionValueHovered, setIsPositionValueHovered] = useState(false);
    const [isFeesHovered, setIsFeesHovered] = useState(false);

    const handleChildEnter = () => setIsHoverDisabled(true);
    const handleChildLeave = () => setIsHoverDisabled(false);
    const handleChildClick = (e: React.MouseEvent) => e.stopPropagation();

    // Helper to determine if fees are zero (same logic as FeesCell)
    const hasZeroFees = React.useMemo(() => {
        if (prefetchedRaw0 === null || prefetchedRaw1 === null) return false; // Loading, show container
        try {
            const raw0 = (position as any)?.unclaimedRaw0 || prefetchedRaw0 || '0';
            const raw1 = (position as any)?.unclaimedRaw1 || prefetchedRaw1 || '0';
            return BigInt(raw0) <= 0n && BigInt(raw1) <= 0n;
        } catch {
            return false; // Error parsing, show container
        }
    }, [prefetchedRaw0, prefetchedRaw1, position]);

    // Calculate total token amounts (position + fees)
    const totalAmounts = React.useMemo(() => {
        if (hasZeroFees || prefetchedRaw0 === null || prefetchedRaw1 === null) {
            return {
                token0: parseFloat(position.token0.amount),
                token1: parseFloat(position.token1.amount)
            };
        }
        try {
            const raw0 = (position as any)?.unclaimedRaw0 || prefetchedRaw0 || '0';
            const raw1 = (position as any)?.unclaimedRaw1 || prefetchedRaw1 || '0';
            
            const d0 = TOKEN_DEFINITIONS?.[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
            const d1 = TOKEN_DEFINITIONS?.[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
            
            const feeAmount0 = parseFloat(formatUnits(BigInt(raw0), d0));
            const feeAmount1 = parseFloat(formatUnits(BigInt(raw1), d1));
            
            return {
                token0: parseFloat(position.token0.amount) + feeAmount0,
                token1: parseFloat(position.token1.amount) + feeAmount1
            };
        } catch {
            return {
                token0: parseFloat(position.token0.amount),
                token1: parseFloat(position.token1.amount)
            };
        }
    }, [hasZeroFees, prefetchedRaw0, prefetchedRaw1, position]);

    // Determine if denomination should be flipped (same logic as pool page)
    const shouldFlipDenomination = React.useMemo(() => {
        if (!currentPrice) return false;
        const currentPriceNum = parseFloat(currentPrice);
        if (!isFinite(currentPriceNum) || currentPriceNum <= 0) return false;
        const inversePrice = 1 / currentPriceNum;
        return inversePrice > currentPriceNum;
    }, [currentPrice]);

    return (
        <Card
            key={position.positionId}
            className={cn(
                "bg-muted/30 border border-sidebar-border/60 transition-colors group cursor-pointer relative",
                !isHoverDisabled && "hover:border-sidebar-border"
            )}
            onClick={onClick}
        >
            {/* Loading overlay for optimistic updates */}
            {(position as any).isOptimisticallyUpdating && (
              <div className="absolute inset-0 bg-muted/20 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                <Image 
                  src="/LogoIconWhite.svg" 
                  alt="Updating..." 
                  width={24}
                  height={24}
                  className="animate-pulse opacity-75"
                />
              </div>
            )}
            <CardContent className="p-3 sm:p-4 group">
            <div className="grid sm:items-center gap-5 grid-cols-[min-content_max-content_max-content_1px_max-content_1fr_7rem] sm:grid-cols-[min-content_max-content_max-content_1px_max-content_1fr_7rem]">
            {/* Column 1: Token Icons - Very narrow */}
            <div className="flex items-center min-w-0 flex-none gap-0">
                {isLoadingPrices || isLoadingPoolStates ? <div className="h-6 w-10 bg-muted/60 rounded-full animate-pulse" /> : <TokenStack position={position as any} />}
            </div>

            {/* Column 2: Position Value - left-bound, size-to-content */}
            <div className="flex items-start pr-2">
                <div 
                    className="flex flex-col gap-1 items-start cursor-pointer"
                    onMouseEnter={() => setIsPositionValueHovered(true)}
                    onMouseLeave={() => setIsPositionValueHovered(false)}
                >
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

            {/* Column 3: Fees - identical styling to Position Value */}
            <div className="flex items-start pr-2">
                <div 
                    className={`flex flex-col gap-1 items-start ${!hasZeroFees ? 'cursor-pointer' : ''}`}
                    onMouseEnter={() => !hasZeroFees && setIsFeesHovered(true)}
                    onMouseLeave={() => !hasZeroFees && setIsFeesHovered(false)}
                >
                <div className="text-xs text-muted-foreground">Fees</div>
                <div className="flex items-center gap-2 truncate">
                    {hasZeroFees ? (
                      <div className="text-xs text-muted-foreground truncate">$0.00</div>
                    ) : isLoadingPrices || prefetchedRaw0 === null || prefetchedRaw1 === null ? (
                      <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
                    ) : (
                      <div className="text-xs font-medium truncate">
                        <FeesCell
                          positionId={position.positionId}
                          sym0={position.token0.symbol || 'T0'}
                          sym1={position.token1.symbol || 'T1'}
                          price0={getUsdPriceForSymbol(position.token0.symbol)}
                          price1={getUsdPriceForSymbol(position.token1.symbol)}
                          prefetchedRaw0={prefetchedRaw0}
                          prefetchedRaw1={prefetchedRaw1}
                        />
                      </div>
                    )}
                </div>
                </div>
            </div>

            {/* Column 4: Vertical Divider */}
            <div className="w-px h-8 bg-border"></div>

            {/* Column 5: Position Amounts - Desktop only, left-bound, size-to-content */}
            <div className="hidden sm:flex items-start pr-2">
                <div className="flex flex-col gap-1 items-start">
                    <div className="flex flex-col gap-0.5 text-xs">
                        {isLoadingPrices ? (
                            <>
                                <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
                                <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
                            </>
                        ) : isFeesHovered && !hasZeroFees ? (
                            // Show fee amounts when fees are hovered
                            <>
                                <div className="font-mono text-muted-foreground">
                                    {(() => {
                                        try {
                                            const raw0 = (position as any)?.unclaimedRaw0 || prefetchedRaw0 || '0';
                                            const d0 = TOKEN_DEFINITIONS?.[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
                                            const amt = parseFloat(formatUnits(BigInt(raw0), d0));
                                            return amt < 0.001 && amt > 0 ? "< 0.001" : amt.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });
                                        } catch {
                                            return "0";
                                        }
                                    })()} {position.token0.symbol}
                                </div>
                                <div className="font-mono text-muted-foreground">
                                    {(() => {
                                        try {
                                            const raw1 = (position as any)?.unclaimedRaw1 || prefetchedRaw1 || '0';
                                            const d1 = TOKEN_DEFINITIONS?.[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
                                            const amt = parseFloat(formatUnits(BigInt(raw1), d1));
                                            return amt < 0.001 && amt > 0 ? "< 0.001" : amt.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });
                                        } catch {
                                            return "0";
                                        }
                                    })()} {position.token1.symbol}
                                </div>
                            </>
                        ) : isPositionValueHovered ? (
                            // Show position amounts only when position value is hovered
                            <>
                                <div className="font-mono text-muted-foreground">
                                    {formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}
                                </div>
                                <div className="font-mono text-muted-foreground">
                                    {formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}
                                </div>
                            </>
                        ) : (
                            // Show total amounts (position + fees) by default
                            <>
                                <div className="font-mono text-muted-foreground">
                                    {(() => {
                                        const amount = totalAmounts.token0;
                                        if (amount < 0.001 && amount > 0) return "< 0.001";
                                        
                                        // If fees are zero, use same formatting as position amounts to avoid precision differences
                                        if (hasZeroFees) {
                                            return formatTokenDisplayAmount(position.token0.amount);
                                        }
                                        
                                        return amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });
                                    })()} {position.token0.symbol}
                                </div>
                                <div className="font-mono text-muted-foreground">
                                    {(() => {
                                        const amount = totalAmounts.token1;
                                        if (amount < 0.001 && amount > 0) return "< 0.001";
                                        
                                        // If fees are zero, use same formatting as position amounts to avoid precision differences
                                        if (hasZeroFees) {
                                            return formatTokenDisplayAmount(position.token1.amount);
                                        }
                                        
                                        return amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });
                                    })()} {position.token1.symbol}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Column 6: Flexible spacer to push Withdraw; absorbs surplus width */}
            <div />

            {/* Column 7: Actions - Static Withdraw button */}
            <div className="flex items-center justify-end gap-2 w-[7rem] flex-none" onMouseEnter={handleChildEnter} onMouseLeave={handleChildLeave} onClick={handleChildClick}>
                <button
                onClick={(e) => {
                    e.stopPropagation();
                    openWithdraw(position);
                }}
                className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-button px-4 py-2 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                Withdraw
                </button>
            </div>
            </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between py-1.5 px-3 bg-muted/10 border-t border-sidebar-border/30 group/subbar">
            <div className="flex items-center text-xs text-muted-foreground gap-3">
                <div>
                    <TooltipProvider delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                        <span className="font-mono tabular-nums flex items-center gap-1.5 cursor-default">
                            <ChevronsLeftRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                            {isLoadingPoolStates ? <div className="h-4 w-24 bg-muted/60 rounded animate-pulse" /> : (() => {
                                // Use flipped denomination logic (same as pool page)
                                const optimalBase = determineBaseTokenForPriceDisplay(
                                    position.token0.symbol || '',
                                    position.token1.symbol || ''
                                );
                                // When flipped, use the opposite token as base to show ascending prices
                                const baseTokenForPriceDisplay = shouldFlipDenomination 
                                    ? (optimalBase === position.token0.symbol ? position.token1.symbol : position.token0.symbol)
                                    : optimalBase;

                                const pool = poolDataByPoolId[poolKey] || poolDataByPoolId[String(position.poolId || '').toLowerCase()] || {};
                                const currentPriceStr = currentPrice || (pool?.price ? String(pool.price) : null);
                                const tickNow = currentPoolTick !== null ? currentPoolTick : (typeof pool?.tick === 'number' ? pool.tick : null);
                                
                                const minPrice = convertTickToPrice(
                                    position.tickLower,
                                    tickNow,
                                    currentPriceStr,
                                    baseTokenForPriceDisplay,
                                    position.token0.symbol || '',
                                    position.token1.symbol || ''
                                );
                                const maxPrice = convertTickToPrice(
                                    position.tickUpper,
                                    tickNow,
                                    currentPriceStr,
                                    baseTokenForPriceDisplay,
                                    position.token0.symbol || '',
                                    position.token1.symbol || ''
                                );
                                
                                // Ensure ascending display order regardless of base/inversion
                                const minNum = parseFloat(minPrice);
                                const maxNum = parseFloat(maxPrice);
                                if (Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum) {
                                    return `${maxPrice} - ${minPrice}`;
                                }
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
                <div>
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
                        // Check if position is full range (ticks near min/max, accounting for tick spacing alignment)
                        const isFullRange = Math.abs(position.tickLower - SDK_MIN_TICK) < 1000 &&
                                          Math.abs(position.tickUpper - SDK_MAX_TICK) < 1000;

                        // Check if position is at risk (within 2% of bounds for volatile pools only)
                        let isAtRisk = false;
                        if (position.isInRange && !isFullRange && currentPoolTick !== null) {
                            // Get pool type from poolDataByPoolId
                            const pool = poolDataByPoolId[poolKey] || poolDataByPoolId[String(position.poolId || '').toLowerCase()] || {};
                            const poolType = pool?.type || 'Volatile'; // Default to Volatile if not specified

                            if (poolType === 'Volatile') {
                                const tickRange = position.tickUpper - position.tickLower;
                                const distanceFromLower = currentPoolTick - position.tickLower;
                                const distanceFromUpper = position.tickUpper - currentPoolTick;

                                // Check if within 2% of either bound
                                const lowerThreshold = tickRange * 0.02;
                                const upperThreshold = tickRange * 0.02;

                                isAtRisk = distanceFromLower <= lowerThreshold || distanceFromUpper <= upperThreshold;
                            }
                        }

                        const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
                        const statusColor = isFullRange ? 'text-green-500' : isAtRisk ? 'text-yellow-500' : position.isInRange ? 'text-green-500' : 'text-red-500';
                        const showTooltip = isAtRisk;

                        const content = (
                            <div className={`flex items-center gap-1.5 ${statusColor} ${showTooltip ? 'cursor-pointer' : ''}`}>
                                <StatusIndicatorCircle className={statusColor} />
                                <span className="text-xs font-medium whitespace-nowrap">{statusText}</span>
                            </div>
                        );

                        if (showTooltip) {
                            return (
                                <TooltipProvider delayDuration={0}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            {content}
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                            <div className="font-medium text-foreground">Position might move out of range soon.</div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            );
                        }

                        return content;
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
                            className="absolute z-[100] right-0 w-max min-w-[140px] rounded-md border border-sidebar-border bg-modal shadow-md overflow-hidden position-card-menu-content"
                            style={{
                            marginTop: positionMenuOpenUp ? undefined : 4,
                            bottom: positionMenuOpenUp ? '100%' : undefined,
                            marginBottom: positionMenuOpenUp ? 4 : undefined,
                            transformOrigin: positionMenuOpenUp ? 'bottom right' : 'top right',
                            willChange: 'transform, opacity',
                            }}
                        >
                            <div className="p-1 grid gap-1">
                            <button type="button" className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30" onClick={(e) => { e.stopPropagation(); openAddLiquidity(position, () => setOpenPositionMenuKey(null)); }}>Add Liquidity</button>
                            <button type="button" className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30" onClick={async (e) => { 
                              e.stopPropagation(); 
                              
                              // Check if fees are zero before attempting to claim
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
                                setOpenPositionMenuKey(null); // Close menu after successful claim
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
                            }}>Claim Fees</button>
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
