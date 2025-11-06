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
import { cn } from "@/lib/utils";
import { Token, FeeDetail } from './swap-interface';
import { TokenSelector, TokenSelectorToken } from './TokenSelector';
import { getToken } from '@/lib/pools-config';
import { findBestRoute } from '@/lib/routing-engine';
import { SlippageControl } from './SlippageControl';

interface SwapInputViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  fromAmount: string;
  toAmount: string;
  handleFromAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activelyEditedSide: 'from' | 'to';
  handleSwapTokens: () => void;
  handleUsePercentage: (percentage: number, isFrom: boolean) => void;
  availableTokens: Token[];
  onFromTokenSelect: (token: Token) => void;
  onToTokenSelect: (token: Token) => void;
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
  swapContainerRect: { top: number; left: number; width: number; height: number; };
  slippage: number;
  isAutoSlippage: boolean;
  autoSlippageValue: number;
  onSlippageChange: (newSlippage: number) => void;
  onAutoSlippageToggle: () => void;
  onCustomSlippageToggle: () => void;
  showRoute?: boolean;
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
  handleUsePercentage,
  availableTokens,
  onFromTokenSelect,
  onToTokenSelect,
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
  isAutoSlippage,
  autoSlippageValue,
  onSlippageChange,
  onAutoSlippageToggle,
  onCustomSlippageToggle,
  showRoute = true,
  onRouteHoverChange,
}: SwapInputViewProps) {
  const [hoveredRouteIndex, setHoveredRouteIndex] = React.useState<number | null>(null);
  const [clickedTokenIndex, setClickedTokenIndex] = React.useState<number | null>(0);
  const ignoreNextOutsideClickRef = React.useRef(false);
  const hoverPreviewActiveRef = React.useRef(false);
  const committedPoolIndexRef = React.useRef<number>(0);
  const [balanceWiggleCount, setBalanceWiggleCount] = React.useState(0);
  const [isSellInputFocused, setIsSellInputFocused] = React.useState(false);
  const [isBuyInputFocused, setIsBuyInputFocused] = React.useState(false);
  const wiggleControls = useAnimation();

  const formatPercentFromBps = React.useCallback((bps: number) => {
    const percent = bps / 100;
    const decimals = percent < 0.1 ? 3 : 2;
    return `${percent.toFixed(decimals)}%`;
  }, []);

  React.useEffect(() => {
    if (onSelectPoolForChart) {
      onSelectPoolForChart(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (balanceWiggleCount > 0) {
      wiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount, wiggleControls]);

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

  return (
    <motion.div
      key="input"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      data-swap-container="true"
    >
      {/* Sell Section */}
      <div className="mb-2">
        <motion.div
          className={cn(
            "group rounded-lg bg-surface p-4 border transition-colors hover:border-sidebar-primary",
            isSellInputFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
          )}
          animate={wiggleControls}
        >
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Sell</Label>
          <Button
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
            onClick={() => handleUsePercentage(100, true)}
            disabled={!isConnected}
          >
            {isConnected ? (isLoadingCurrentFromTokenBalance ? "Loading..." : displayFromToken.balance) : "~"} {displayFromToken.symbol}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <TokenSelector
            selectedToken={displayFromToken as TokenSelectorToken}
            availableTokens={availableTokens as TokenSelectorToken[]}
            onTokenSelect={onFromTokenSelect}
            excludeToken={displayToToken as TokenSelectorToken}
            disabled={!isConnected || isAttemptingSwitch}
            swapContainerRect={swapContainerRect}
          />
          <div className="flex-1">
            <Input
              value={fromAmount}
              onChange={handleFromAmountChangeWithWiggle}
              onFocus={() => setIsSellInputFocused(true)}
              onBlur={() => setIsSellInputFocused(false)}
              className={cn(
                "border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto input-enhanced focus-visible:rounded-none focus-visible:outline-none",
                { "opacity-50": quoteLoading && activelyEditedSide === 'to' }
              )}
              placeholder="0"
              disabled={!isConnected || isAttemptingSwitch}
            />
            <div className="relative text-right text-xs min-h-5">
              {/* USD Value - hide on hover */}
              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                "opacity-50": quoteLoading && activelyEditedSide === 'to',
                "group-hover:opacity-0": isConnected && parseFloat(displayFromToken.balance || "0") > 0
              })}>
                {formatCurrency((parseFloat(fromAmount || "0") * (displayFromToken.usdPrice || 0)).toString())}
              </div>
              {/* Percentage buttons - show on hover */}
              {isConnected && parseFloat(displayFromToken.balance || "0") > 0 && (
                <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                  {[25, 50, 75, 100].map((percentage, index) => (
                    <motion.div
                      key={percentage}
                      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                      style={{
                        transitionDelay: `${index * 40}ms`,
                        transitionDuration: '200ms',
                        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                      }}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUsePercentage(percentage, true);
                        }}
                      >
                        {percentage === 100 ? 'MAX' : `${percentage}%`}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </motion.div>
      </div>

      {/* Arrow button */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg bg-muted/30 border-0 hover:bg-muted/50 hover:border hover:border-sidebar-border/60 z-10 h-8 w-8"
          onClick={handleSwapTokens}
          disabled={!isConnected || isAttemptingSwitch}
        >
          <ArrowDownIcon className="h-4 w-4" />
          <span className="sr-only">Swap tokens</span>
        </Button>
      </div>

      {/* Buy Section */}
      <div className="mt-2">
        <div
          className={cn(
            "group rounded-lg bg-surface p-4 border transition-colors hover:border-sidebar-primary",
            isBuyInputFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
          )}
        >
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Buy</Label>
          <Button
            variant="ghost"
            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
            onClick={() => handleUsePercentage(100, false)}
            disabled={!isConnected}
          >
            {isConnected ? (isLoadingCurrentToTokenBalance ? "Loading..." : displayToToken.balance) : "~"} {displayToToken.symbol}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <TokenSelector
            selectedToken={displayToToken as TokenSelectorToken}
            availableTokens={availableTokens as TokenSelectorToken[]}
            onTokenSelect={onToTokenSelect}
            excludeToken={displayFromToken as TokenSelectorToken}
            disabled={!isConnected || isAttemptingSwitch}
            swapContainerRect={swapContainerRect}
          />
          <div className="flex-1">
            <Input
              value={toAmount}
              onChange={onToAmountChange}
              onFocus={() => setIsBuyInputFocused(true)}
              onBlur={() => setIsBuyInputFocused(false)}
              disabled={!isConnected || isAttemptingSwitch}
              className={cn(
                "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                { "opacity-50": quoteLoading && activelyEditedSide === 'from' }
              )}
              placeholder="0"
            />
            <div className="relative text-right text-xs min-h-5">
              {/* USD Value - hide on hover */}
              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                "opacity-50": quoteLoading && activelyEditedSide === 'from',
                "group-hover:opacity-0": isConnected && parseFloat(displayToToken.balance || "0") > 0
              })}>
                {(() => {
                  const amount = parseFloat(toAmount || "");
                  if (!toAmount || isNaN(amount)) return "$0.00";
                  return formatCurrency((amount * (displayToToken.usdPrice || 0)).toString());
                })()}
              </div>
              {/* Percentage buttons - show on hover */}
              {isConnected && parseFloat(displayToToken.balance || "0") > 0 && (
                <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                  {[25, 50, 75, 100].map((percentage, index) => (
                    <motion.div
                      key={percentage}
                      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                      style={{
                        transitionDelay: `${index * 40}ms`,
                        transitionDuration: '200ms',
                        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                      }}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUsePercentage(percentage, false);
                        }}
                      >
                        {percentage === 100 ? 'MAX' : `${percentage}%`}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Route, Fee, and Slippage Information */}
      <div className="mt-4 space-y-1.5">
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
              <div className="flex items-center gap-2">
                <span>Route:</span>
              </div>

              <div className="flex items-center gap-3">
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

                    const pairMargin = 10;
                    const hoverMargin = 10;

                    const baseWidth = path.length > 0 ? iconSize + (path.length - 1) * step : 0;

                    const gaps: number[] = Array(Math.max(0, path.length - 1)).fill(0);

                    const rawPoolIndex = selectedPoolIndexForChart;
                    const poolIndex = Math.max(0, Math.min(rawPoolIndex, path.length - 2));
                    if (clickedTokenIndex !== null) {
                      if (poolIndex > 0) gaps[poolIndex - 1] = Math.max(gaps[poolIndex - 1], pairMargin);
                      if (poolIndex < path.length - 2) gaps[poolIndex + 1] = Math.max(gaps[poolIndex + 1], pairMargin);
                    }

                    if (hoveredRouteIndex !== null && path.length > 1) {
                      const h = hoveredRouteIndex;
                      const applyLeft = h > 0;
                      const applyRight = h < path.length - 1;
                      if (applyLeft) gaps[h - 1] = Math.max(gaps[h - 1], hoverMargin);
                      if (applyRight) gaps[h] = Math.max(gaps[h], hoverMargin);
                    }

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
                        initial={{ width: animatedWidth }}
                        animate={{ width: animatedWidth }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      >
                        {clickedTokenIndex !== null && (() => {
                          const ringPadding = 3;

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

                                  const currentStart = Math.max(0, Math.min((committedPoolIndexRef.current ?? selectedPoolIndexForChart), maxPoolIdx));
                                  let nextStart = currentStart;
                                  if (index <= currentStart - 1) {
                                    nextStart = currentStart - 1;
                                  } else if (index >= currentStart + 2) {
                                    nextStart = currentStart + 1;
                                  } else {
                                    nextStart = currentStart;
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

            {parseFloat(fromAmount || "0") > 0 && (
              <div className="py-0.5">
                <div className="border-t border-dashed border-muted-foreground/20" />
              </div>
            )}

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

                <SlippageControl
                  currentSlippage={slippage}
                  isAuto={isAutoSlippage}
                  autoSlippage={autoSlippageValue}
                  onSlippageChange={onSlippageChange}
                  onAutoToggle={onAutoSlippageToggle}
                  onCustomToggle={onCustomSlippageToggle}
                />

                <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
                  <span>Min Received:</span>
                  <span className="text-foreground/80 font-medium">
                    {calculatedValues.minimumReceived} {displayToToken.symbol}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 h-10">
        {!isMounted ? null : isConnected ? (
          <Button
            className={cn(
              "w-full",
              actionButtonDisabled ?
                "relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                :
                "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary transition-colors duration-200"
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
            className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
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
