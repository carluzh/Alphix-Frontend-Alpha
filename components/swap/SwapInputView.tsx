"use client";

import React from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowDownIcon,
  ChevronRightIcon,
  ChevronsRight,
  InfoIcon,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatTokenAmount } from "@/lib/utils";
import { Token, FeeDetail, OutlineArcIcon } from './swap-interface';
import { TokenSelector, TokenSelectorToken } from './TokenSelector';
import { getToken } from '@/lib/pools-config';
import { findBestRoute } from '@/lib/routing-engine';

interface SwapInputViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  fromAmount: string;
  toAmount: string;
  handleFromAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activelyEditedSide: 'from' | 'to';
  handleSwapTokens: () => void;
  handleUseFullBalance: (token: Token, isFrom: boolean) => void;
  availableTokens: Token[];
  onFromTokenSelect: (token: Token) => void;
  onToTokenSelect: (token: Token) => void;
  handleCyclePercentage: () => void;
  handleMouseEnterArc: () => void;
  handleMouseLeaveArc: () => void;
  actualNumericPercentage: number;
  currentSteppedPercentage: number;
  hoveredArcPercentage: number | null;
  isSellInputFocused: boolean;
  setIsSellInputFocused: (value: boolean) => void;
  formatCurrency: (value: string) => string;
  isConnected: boolean;
  isAttemptingSwitch: boolean;
  isLoadingCurrentFromTokenBalance: boolean;
  isLoadingCurrentToTokenBalance: boolean;
  calculatedValues: {
    fees: FeeDetail[];
    minimumReceived: string;
  };
  dynamicFeeLoading: boolean;
  quoteLoading: boolean;
  quoteError?: string | null;
  actionButtonText: string;
  actionButtonDisabled: boolean;
  handleSwap: () => void;
  isMounted: boolean;
  currentChainId: number | undefined;
  TARGET_CHAIN_ID: number;
  strokeWidth?: number;
  routeInfo?: {
    path: string[];
    hops: number;
    isDirectRoute: boolean;
    pools: string[];
  } | null;
  routeFees?: Array<{ poolName: string; fee: number }>;
  routeFeesLoading?: boolean;
  selectedPoolIndexForChart?: number;
  onSelectPoolForChart?: (poolIndex: number) => void;
  swapContainerRect: { top: number; left: number; width: number; height: number; }; // New prop
  slippage: number; // Add slippage prop
  onSlippageChange: (newSlippage: number) => void; // Add slippage change handler
  showRoute?: boolean; // control showing route section
  onRouteHoverChange?: (hover: boolean) => void;
}

export function SwapInputView({
  displayFromToken,
  displayToToken,
  fromAmount,
  toAmount,
  handleFromAmountChange,
  onToAmountChange,
  activelyEditedSide,
  handleSwapTokens,
  handleUseFullBalance,
  availableTokens,
  onFromTokenSelect,
  onToTokenSelect,
  handleCyclePercentage,
  handleMouseEnterArc,
  handleMouseLeaveArc,
  actualNumericPercentage,
  currentSteppedPercentage,
  hoveredArcPercentage,
  isSellInputFocused,
  setIsSellInputFocused,
  formatCurrency,
  isConnected,
  isAttemptingSwitch,
  isLoadingCurrentFromTokenBalance,
  isLoadingCurrentToTokenBalance,
  calculatedValues,
  dynamicFeeLoading,
  quoteLoading,
  quoteError,
  actionButtonText,
  actionButtonDisabled,
  handleSwap,
  isMounted,
  currentChainId,
  TARGET_CHAIN_ID,
  strokeWidth = 2,
  routeInfo,
  routeFees,
  routeFeesLoading,
  selectedPoolIndexForChart = 0,
  onSelectPoolForChart,
  swapContainerRect,
  slippage,
  onSlippageChange,
  showRoute = true,
  onRouteHoverChange,
}: SwapInputViewProps) {
  const [hoveredRouteIndex, setHoveredRouteIndex] = React.useState<number | null>(null);
  const [isSlippageEditing, setIsSlippageEditing] = React.useState(false);
  const [customSlippage, setCustomSlippage] = React.useState("");
  const [isCustomSlippage, setIsCustomSlippage] = React.useState(false);
  const slippageRef = React.useRef<HTMLDivElement>(null);
  const [clickedTokenIndex, setClickedTokenIndex] = React.useState<number | null>(0);
  const ignoreNextOutsideClickRef = React.useRef(false);
  const hoverPreviewActiveRef = React.useRef(false);
  const committedPoolIndexRef = React.useRef<number>(0);
  const [balanceWiggleCount, setBalanceWiggleCount] = React.useState(0);
  const wiggleControls = useAnimation();

  const formatPercentFromBps = React.useCallback((bps: number) => {
    // Convert basis points to percentage points: 1 bps = 0.01%
    const percent = bps / 100;
    const decimals = percent < 0.1 ? 3 : 2;
    return `${percent.toFixed(decimals)}%`;
  }, []);

  const presetSlippages = [0.05, 0.10, 0.50, 1.00];

  // Ensure first pool is selected initially
  React.useEffect(() => {
    if (onSelectPoolForChart) {
      onSelectPoolForChart(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const handleSlippageSelect = (value: number) => {
    onSlippageChange(value);
    // Keep the panel open until the arrow is clicked again
    setIsCustomSlippage(false);
  };

  const handleCustomSlippageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers and decimal point
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      const numValue = parseFloat(value);
      if (value === "" || (numValue >= 0 && numValue <= 99)) {
        setCustomSlippage(value);
      }
    }
  };

  const handleCustomSlippageSubmit = () => {
    if (customSlippage && !isNaN(parseFloat(customSlippage))) {
      const rounded = Math.round(parseFloat(customSlippage) * 100) / 100; // Round to 2 decimals
      onSlippageChange(rounded);
      // Keep the panel open until the arrow is clicked again
      setCustomSlippage("");
    }
  };

  const handleCustomSlippageKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomSlippageSubmit();
    } else if (e.key === 'Escape') {
      setIsSlippageEditing(false);
      setIsCustomSlippage(false);
      setCustomSlippage("");
    }
  };

  React.useEffect(() => {
    if (balanceWiggleCount > 0) {
      wiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount, wiggleControls]);

  

  // Allow any input; wiggle once when crossing from within-balance to over-balance
  const handleFromAmountChangeWithWiggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const nextRaw = e.target.value;
      const nextVal = parseFloat(nextRaw || "");
      const bal = parseFloat(displayFromToken.balance || "0");
      const prevVal = parseFloat(fromAmount || "");
      const wasOver = Number.isFinite(prevVal) && Number.isFinite(bal) ? prevVal > bal : false;
      const isOver = Number.isFinite(nextVal) && Number.isFinite(bal) ? nextVal > bal : false;
      if (isOver && !wasOver) {
        setBalanceWiggleCount((c) => c + 1);
      }
    } catch {}
    handleFromAmountChange(e);
  };

  // Keep the slippage editor open until the arrow is clicked again
  // Disable outside-click to close behavior
  React.useEffect(() => {
    return;
  }, [isSlippageEditing]);
  return (
    <motion.div 
      key="input" 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0, y: -20 }} 
      transition={{ duration: 0.2 }}
      data-swap-container="true"
    >
      {/* Sell Section - Uses `displayFromToken` */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Sell</Label>
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(displayFromToken, true)} disabled={!isConnected}>
                Balance: { (isConnected ? (isLoadingCurrentFromTokenBalance ? "Loading..." : displayFromToken.balance) : "~")} {displayFromToken.symbol}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded-full hover:bg-muted/40"
              onClick={handleCyclePercentage}
              onMouseEnter={handleMouseEnterArc}
              onMouseLeave={handleMouseLeaveArc}
              disabled={!isConnected}
            >
              <OutlineArcIcon
                actualPercentage={actualNumericPercentage}
                steppedPercentage={currentSteppedPercentage}
                hoverPercentage={hoveredArcPercentage}
                isOverLimit={actualNumericPercentage > 100}
              />
            </Button>
          </div>
        </div>
        <motion.div 
          className={cn(
            "rounded-lg bg-[var(--token-container-background)] p-4 border transition-colors hover:border-[var(--token-container-border-hover)]",
            isSellInputFocused
              ? "border-[var(--token-container-border-hover)]"
              : "border-transparent"
          )}
          animate={wiggleControls}
        >
          <div className="flex items-center gap-2">
            <TokenSelector
              selectedToken={displayFromToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onFromTokenSelect}
              excludeToken={displayToToken as TokenSelectorToken}
              disabled={!isConnected || isAttemptingSwitch}
              swapContainerRect={swapContainerRect} // Pass the new prop
            />
            <div className="flex-1">
              <Input
                value={fromAmount}
                onChange={handleFromAmountChangeWithWiggle}
                onFocus={() => setIsSellInputFocused(true)}
                onBlur={() => setIsSellInputFocused(false)}
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto input-enhanced focus-visible:rounded-none focus-visible:outline-none"
                placeholder="0"
                disabled={!isConnected || isAttemptingSwitch}
              />
              <div className="text-right text-xs text-muted-foreground">
                {formatCurrency((parseFloat(fromAmount || "0") * displayFromToken.usdPrice).toString())}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" size="icon" className="rounded-full bg-muted/30 z-10 h-8 w-8" onClick={handleSwapTokens} disabled={!isConnected || isAttemptingSwitch}>
          <ArrowDownIcon className="h-4 w-4" />
          <span className="sr-only">Swap tokens</span>
        </Button>
      </div>

      {/* Buy Section - Uses `displayToToken` */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Buy</Label>
          <span className={cn("text-xs text-muted-foreground", { "opacity-50": !isConnected })}>
              Balance: { (isConnected ? (isLoadingCurrentToTokenBalance ? "Loading..." : displayToToken.balance) : "~")} {displayToToken.symbol}
            </span>
        </div>
        <div 
          className="rounded-lg bg-[var(--token-container-background)] p-4 border border-transparent"
        >
          <div className="flex items-center gap-2">
            <TokenSelector
              selectedToken={displayToToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onToTokenSelect}
              excludeToken={displayFromToken as TokenSelectorToken}
              disabled={!isConnected || isAttemptingSwitch}
              swapContainerRect={swapContainerRect} // Pass the new prop
            />
            <div className="flex-1">
              <Input
                value={toAmount}
                onChange={onToAmountChange}
                disabled={!isConnected || isAttemptingSwitch}
                className={cn(
                  "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                  { "text-muted-foreground animate-pulse": quoteLoading && activelyEditedSide === 'from' }
                )}
                placeholder="0"
              />
              <div className={cn(
                "text-right text-xs text-muted-foreground",
                { "animate-pulse": quoteLoading && activelyEditedSide === 'from' }
              )}>
                {(() => {
                  const amount = parseFloat(toAmount || "");
                  if (!toAmount || isNaN(amount)) return "";
                  return formatCurrency((amount * displayToToken.usdPrice).toString());
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Route, Fee, and Slippage Information */}
      {/* Route can be toggled via showRoute */}
      <div className="mt-3 mb-1 space-y-1.5">
        {showRoute && isConnected && currentChainId === TARGET_CHAIN_ID && (
          <>
            <div
              className="flex items-center justify-between text-xs text-muted-foreground"
              onMouseLeave={() => {
                setHoveredRouteIndex(null);
                if (hoverPreviewActiveRef.current) {
                  hoverPreviewActiveRef.current = false;
                  onRouteHoverChange?.(false);
                }
              }}
            >
              <div className="flex items-center gap-2"> {/* Left section: Route label */}
                <span>Route:</span>
              </div>

              <div className="flex items-center gap-3"> {/* Right section: Fee and Token Picker */}
                {/* Currently selected pool fee percentage */}
                {clickedTokenIndex !== null && routeFees?.[selectedPoolIndexForChart] && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">
                      {quoteError ? (
                        "-"
                      ) : routeFeesLoading ? (
                        <div className="h-3 w-8 bg-muted/60 rounded animate-pulse"></div>
                      ) : (
                        formatPercentFromBps(routeFees[selectedPoolIndexForChart].fee)
                      )}
                    </span>
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-pointer" />
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs max-w-xs">
                          <p>
                            {(() => {
                              const fromSym = routeInfo?.path?.[selectedPoolIndexForChart] ?? displayFromToken.symbol;
                              const toIdx = Math.min((routeInfo?.path?.length || 1) - 1, selectedPoolIndexForChart + 1);
                              const toSym = routeInfo?.path?.[toIdx] ?? displayToToken.symbol;
                              return (
                                <span className="inline-flex items-center gap-1.5">
                                  <span>{fromSym}</span>
                                  <ChevronsRight className="h-3 w-3 text-muted-foreground/70" />
                                  <span>{toSym}</span>
                                </span>
                              );
                            })()}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
                
                {/* Animated token picker */}
                <div className="relative flex items-center h-7">
                  {(() => {
                    const path = routeInfo?.path || [displayFromToken.symbol, displayToToken.symbol];
                    const iconSize = 20;
                    const overlap = 0.3 * iconSize;
                    const step = iconSize - overlap;

                    const pairMargin = 10; // same as hover margin for consistency
                    const hoverMargin = 10;

                    const baseWidth = path.length > 0 ? iconSize + (path.length - 1) * step : 0;

                    // Compute boundary gaps (between token i and i+1), using max() so hover never over-increases existing pair margins
                    const gaps: number[] = Array(Math.max(0, path.length - 1)).fill(0);

                    // Pair margins (added before and after the selected pair, never inside it)
                    const rawPoolIndex = selectedPoolIndexForChart;
                    const poolIndex = Math.max(0, Math.min(rawPoolIndex, path.length - 2));
                    if (clickedTokenIndex !== null) {
                      if (poolIndex > 0) gaps[poolIndex - 1] = Math.max(gaps[poolIndex - 1], pairMargin);
                      if (poolIndex < path.length - 2) gaps[poolIndex + 1] = Math.max(gaps[poolIndex + 1], pairMargin);
                    }

                    // Hover margins: symmetrical (left and right) except at edges
                    if (hoveredRouteIndex !== null && path.length > 1) {
                      const h = hoveredRouteIndex;
                      const applyLeft = h > 0;
                      const applyRight = h < path.length - 1;
                      if (applyLeft) gaps[h - 1] = Math.max(gaps[h - 1], hoverMargin);
                      if (applyRight) gaps[h] = Math.max(gaps[h], hoverMargin);
                    }

                    // Prefix sums to get per-token x offsets
                    const offsets: number[] = new Array(path.length).fill(0);
                    for (let i = 1; i < path.length; i++) {
                      offsets[i] = offsets[i - 1] + (gaps[i - 1] || 0);
                    }

                    const totalExtraWidth = gaps.reduce((a, b) => a + b, 0);
                    const animatedWidth = baseWidth + totalExtraWidth;

                    const isRouteHovered = hoveredRouteIndex !== null;

                    return (
                      <motion.div
                        className="relative"
                        style={{ height: iconSize }}
                        animate={{ width: animatedWidth }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      >
                        {/* Group outline for selected pair */}
                        {clickedTokenIndex !== null && (() => {
                          const ringPadding = 3; // small margin so hover-scaled tokens fit inside

                          // Final positions of the pair's tokens (left edges) with offsets
                          const token1FinalLeft = (poolIndex * step) + offsets[poolIndex];
                          const token2FinalLeft = ((poolIndex + 1) * step) + offsets[poolIndex + 1];

                          const ringLeft = token1FinalLeft - ringPadding;
                          const ringTop = -ringPadding;
                          const ringWidth = (token2FinalLeft + iconSize) - token1FinalLeft + (ringPadding * 2);
                          const ringHeight = iconSize + (ringPadding * 2);

                          return (
                            <motion.div
                              className="absolute top-0 left-0"
                              initial={false}
                              animate={{ x: ringLeft, y: ringTop, width: ringWidth, height: ringHeight }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                              style={{ pointerEvents: 'none', zIndex: 0 }}
                            >
                              <svg width="100%" height="100%">
                                <rect
                                  x="0.5"
                                  y="0.5"
                                  width="calc(100% - 1px)"
                                  height="calc(100% - 1px)"
                                  rx={ringHeight / 2}
                                  fill="var(--sidebar-connect-button-bg)"
                                  stroke="white"
                                  strokeWidth="1"
                                  strokeOpacity={isRouteHovered ? 0.3 : 0.18}
                                />
                              </svg>
                            </motion.div>
                          );
                        })()}
                        {path.map((tokenSymbol, index) => {
                          const tokenConfig = getToken(tokenSymbol);
                          const tokenIcon = tokenConfig?.icon || "/placeholder-logo.svg";

                          // Determine selected pair (both tokens get outline)
                          const isSelected = clickedTokenIndex !== null && (index === poolIndex || index === poolIndex + 1);

                          const leftPos = index * step;
                          const xOffset = offsets[index];

                          return (
                            <motion.div
                              key={tokenSymbol}
                              className="absolute top-0"
                              style={{
                                zIndex: index + 1,
                                left: `${leftPos}px`
                              }}
                              animate={{ x: xOffset }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                              onHoverStart={() => {
                                setHoveredRouteIndex(index);
                                const n = path.length;
                                if (n >= 2 && onSelectPoolForChart) {
                                  const poolsCount = (routeInfo?.pools.length || Math.max(1, n - 1));
                                  const maxPoolIdx = Math.max(0, poolsCount - 1);

                                  // Stepwise selection change based on relative hover position
                                  const currentStart = Math.max(0, Math.min((committedPoolIndexRef.current ?? selectedPoolIndexForChart), maxPoolIdx));
                                  let nextStart = currentStart;
                                  if (index <= currentStart - 1) {
                                    nextStart = currentStart - 1; // move one step left
                                  } else if (index >= currentStart + 2) {
                                    nextStart = currentStart + 1; // move one step right
                                  } else {
                                    nextStart = currentStart; // hovering within or adjacent keeps current
                                  }
                                  nextStart = Math.max(0, Math.min(nextStart, maxPoolIdx));

                                  committedPoolIndexRef.current = nextStart;
                                  onSelectPoolForChart(nextStart);
                                  if (!hoverPreviewActiveRef.current) {
                                    hoverPreviewActiveRef.current = true;
                                    onRouteHoverChange?.(true);
                                  }
                                }
                              }}
                              onHoverEnd={() => {
                                setHoveredRouteIndex(null);
                                if (hoverPreviewActiveRef.current) {
                                  hoverPreviewActiveRef.current = false;
                                  onRouteHoverChange?.(false);
                                }
                              }}
                            >
                              <div className="flex items-center">
                                <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <motion.div
                                        className="relative cursor-pointer"
                                        whileHover={{ scale: 1.08 }}
                                        style={{
                                          padding: `${iconSize * 0.1}px`,
                                          margin: `-${iconSize * 0.1}px`
                                        }}
                                        // Click disabled: selection persists from last hover
                                        onClick={() => {}}
                                      >
                                        <Image
                                          src={tokenIcon}
                                          alt={tokenSymbol}
                                          width={iconSize}
                                          height={iconSize}
                                          className={cn(
                                            "rounded-full bg-background transition-all duration-200"
                                          )}
                                        />
                                      </motion.div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                      {tokenSymbol}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Divider: Only shows if Route is visible and there's an amount */}
            {parseFloat(fromAmount || "0") > 0 && (
              <div className="py-0.5">
                <div className="border-t border-dashed border-muted-foreground/20" />
              </div>
            )}

            {/* Fee and Slippage: Shown for any swap with an amount */}
            {parseFloat(fromAmount || "0") > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Fee:</span>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      if (quoteError) {
                        return (
                          <span className="text-foreground/80 font-medium">-</span>
                        );
                      }
                      if (routeFeesLoading) {
                        return <div className="h-3 w-16 bg-muted/60 rounded animate-pulse"></div>;
                      }
                      if (!routeFees || routeFees.length === 0) {
                        return <span className="text-muted-foreground">N/A</span>;
                      }
                      const totalFeeBps = routeFees.reduce((total, routeFee) => total + routeFee.fee, 0);
                      const inputAmountUSD = parseFloat(fromAmount || "0") * (displayFromToken.usdPrice || 0);
                      // totalFeeBps is in basis points; convert to fraction by dividing by 10,000
                      const feeInUSD = inputAmountUSD * (totalFeeBps / 10000);
                      const isMultiHop = (routeInfo?.path?.length || 2) > 2;
                      const percentDisplay = formatPercentFromBps(totalFeeBps);
                      const amountDisplay = feeInUSD > 0 && feeInUSD < 0.01 ? "< $0.01" : formatCurrency(feeInUSD.toString());
                      return (
                        <>
                          {isMultiHop && <span className="text-muted-foreground">{percentDisplay}</span>}
                          {isMultiHop && (
                            <TooltipProvider delayDuration={0}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <InfoIcon className="h-3 w-3 mr-1 text-muted-foreground/60 hover:text-muted-foreground cursor-pointer" />
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs max-w-xs">
                                  Total Fee for Swap
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          <span className="text-foreground/80 font-medium">{amountDisplay}</span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Max Slippage and Minimum Received - one row + inline presets row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5" ref={slippageRef}>
                    <span>Max Slippage:</span>
                    {quoteError ? (
                      <span className="text-foreground/80 font-medium">-</span>
                    ) : (
                      <button
                        type="button"
                        className="flex items-center gap-0.5 text-foreground/80 font-medium"
                        onClick={() => {
                          ignoreNextOutsideClickRef.current = true;
                          setIsSlippageEditing((v) => !v);
                          setCustomSlippage(slippage.toString());
                        }}
                      >
                        <span>{slippage}%</span>
                        <motion.span
                          animate={{ rotate: isSlippageEditing ? 180 : 0 }}
                          transition={{ type: "tween", duration: 0.18 }}
                        >
                          <ChevronDownIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
                        </motion.span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Min Received:</span>
                    <span className="text-foreground/80 font-medium">
                      {calculatedValues.minimumReceived} {displayToToken.symbol}
                    </span>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {!quoteError && isSlippageEditing && (
                    <motion.div
                      key="slippage-row"
                      className="flex flex-wrap items-center gap-1.5 pt-1"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      {presetSlippages.map((val) => (
                        <button
                          key={val}
                          type="button"
                          className={cn(
                            "px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground transition-colors",
                            "hover:brightness-110 hover:border-white/30",
                            slippage === val && "border-white/30"
                          )}
                          onClick={() => handleSlippageSelect(val)}
                        >
                          {val.toFixed(2)}%
                        </button>
                      ))}
                      {/* Custom option */}
                      {!isCustomSlippage ? (
                        <button
                          type="button"
                          className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground transition-colors hover:brightness-110 hover:border-white/30"
                          onClick={() => {
                            setIsCustomSlippage(true);
                            setCustomSlippage(slippage.toString());
                          }}
                        >
                          Custom
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={customSlippage}
                            onChange={handleCustomSlippageInput}
                            onKeyDown={handleCustomSlippageKeyDown}
                            onBlur={handleCustomSlippageSubmit}
                            placeholder="0.00"
                            className="w-14 px-1 py-0.5 text-xs text-center bg-background border-0 outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 rounded"
                            autoFocus
                          />
                          <span className="text-xs">%</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </div>


      <div className="mt-4 h-10">
        {!isMounted ? null : isConnected ? (
          <Button
            className={cn(
              "w-full", // Always applies full width
              // Conditional styles for disabled state (matches sidebar's Connect Wallet)
              actionButtonDisabled ?
                "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                : // Styles for enabled state (original "btn-primary" look)
                "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
            )}
            onClick={handleSwap}
            disabled={actionButtonDisabled ||
                        (
                          parseFloat(fromAmount || "0") > 0 &&
                          (
                            isNaN(parseFloat(displayFromToken.balance || "0")) ||
                            parseFloat(displayFromToken.balance || "0") < parseFloat(fromAmount || "0")
                          )
                        )
                      }
            style={actionButtonDisabled ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          >
            {actionButtonText}
          </Button>
        ) : (
          <div
            className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
            style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            {/* @ts-expect-error custom element provided by wallet kit */}
            <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
            <span className="relative z-0 pointer-events-none">{actionButtonText}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
} 