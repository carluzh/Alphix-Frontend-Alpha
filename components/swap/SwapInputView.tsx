"use client";

import React from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowDownIcon,
  ChevronRightIcon,
  ChevronsRight,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { IconTriangleWarningFilled } from "nucleo-micro-bold-essential";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Token } from './swap-interface';
import { TokenSelector, TokenSelectorToken } from './TokenSelector';
import { getToken } from '@/lib/pools-config';
import { SlippageControl } from './SlippageControl';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { useSlippageValidation } from '@/hooks/useSlippage';
import { useIsMobile } from "@/hooks/use-mobile";
import type { SwapTradeModel } from "./useSwapTrade";
import type { PriceDeviationResult } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout } from "@/components/ui/PriceDeviationCallout";

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
  isConnected: boolean;
  isAttemptingSwitch: boolean;
  isLoadingCurrentFromTokenBalance: boolean;
  isLoadingCurrentToTokenBalance: boolean;
  trade: SwapTradeModel;
  actionButtonText: string;
  actionButtonDisabled: boolean;
  handleSwap: () => void;
  isMounted: boolean;
  currentChainId: number | undefined;
  TARGET_CHAIN_ID: number;
  strokeWidth?: number;
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
  onNetworkSwitch?: () => void;
  onClearFromAmount?: () => void;
  priceDeviation?: PriceDeviationResult;
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
  isConnected,
  isAttemptingSwitch,
  isLoadingCurrentFromTokenBalance,
  isLoadingCurrentToTokenBalance,
  trade,
  actionButtonText,
  actionButtonDisabled,
  handleSwap,
  isMounted,
  currentChainId,
  TARGET_CHAIN_ID,
  strokeWidth = 2,
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
  onNetworkSwitch,
  onClearFromAmount,
  priceDeviation,
}: SwapInputViewProps) {
  const isMobile = useIsMobile();
  const [hoveredRouteIndex, setHoveredRouteIndex] = React.useState<number | null>(null);
  const [clickedTokenIndex, setClickedTokenIndex] = React.useState<number | null>(0);
  const ignoreNextOutsideClickRef = React.useRef(false);
  const hoverPreviewActiveRef = React.useRef(false);
  const committedPoolIndexRef = React.useRef<number>(0);
  const [balanceWiggleCount, setBalanceWiggleCount] = React.useState(0);
  const [isSellInputFocused, setIsSellInputFocused] = React.useState(false);
  const [isBuyInputFocused, setIsBuyInputFocused] = React.useState(false);
  const wiggleControls = useAnimation();

  const swapInputPriceSymbols = React.useMemo(
    () => [displayFromToken.symbol, displayToToken.symbol].filter(Boolean),
    [displayFromToken.symbol, displayToToken.symbol]
  );
  const { prices: swapInputPrices } = useTokenPrices(swapInputPriceSymbols);
  const fromTokenPrice = { price: swapInputPrices[displayFromToken.symbol] || null };
  const toTokenPrice = { price: swapInputPrices[displayToToken.symbol] || null };
  const { showWarning: showSlippageWarning, warningMessage: slippageWarningMessage, isCritical: isSlippageCritical } = useSlippageValidation(slippage);

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

  const swapDisabledDueToBalance =
    parseFloat(fromAmount || "0") > 0 &&
    (
      isNaN(parseFloat(displayFromToken.balance || "0")) ||
      parseFloat(displayFromToken.balance || "0") < parseFloat(fromAmount || "0")
    );

  const isSwapBaseDisabled = actionButtonDisabled || trade.quoteLoading;
  const isSwapDisabled = isSwapBaseDisabled || swapDisabledDueToBalance;

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
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes inputGradientFlow {
            from { background-position: 0% 0%; }
            to { background-position: 300% 0%; }
          }
          .input-gradient-hover {
            position: relative;
            border-radius: 8px;
          }
          .input-gradient-hover::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: 9px;
            background: linear-gradient(
              45deg,
              #f94706,
              #ff7919 25%,
              #f94706 50%,
              #ff7919 75%,
              #f94706 100%
            );
            background-size: 300% 100%;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
            z-index: 0;
            animation: inputGradientFlow 10s linear infinite;
          }
          .input-gradient-hover:focus-within::before {
            opacity: 1;
          }
        `}} />
        <div className="input-gradient-hover">
          <motion.div
            className={cn(
              "relative z-[1] group rounded-lg bg-surface p-4 border transition-colors",
              isSellInputFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
            )}
            animate={wiggleControls}
          >
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Sell</Label>
          {/* Mobile: Show "Clear" when input has value, otherwise show balance */}
          {isMobile && onClearFromAmount && fromAmount.length > 0 ? (
            <button
              type="button"
              className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer"
              onClick={onClearFromAmount}
            >
              Clear
            </button>
          ) : (
            <Button
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={() => handleUsePercentage(100, true)}
              disabled={!isConnected}
            >
              {isConnected ? (isLoadingCurrentFromTokenBalance ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" /> : displayFromToken.balance) : "~"} {displayFromToken.symbol}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Token Selector - prevent keyboard popup on mobile by stopping propagation */}
          <div onClick={isMobile ? (e) => e.stopPropagation() : undefined}>
            <TokenSelector
              selectedToken={displayFromToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onFromTokenSelect}
              excludeToken={displayToToken as TokenSelectorToken}
              disabled={isAttemptingSwitch}
              swapContainerRect={swapContainerRect}
            />
          </div>
          <div className="flex-1">
            <Input
              type={isMobile ? "number" : "text"}
              inputMode={isMobile ? "decimal" : undefined}
              step={isMobile ? "any" : undefined}
              value={fromAmount}
              onChange={handleFromAmountChangeWithWiggle}
              onFocus={() => setIsSellInputFocused(true)}
              onBlur={() => setIsSellInputFocused(false)}
              className={cn(
                "border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto input-enhanced focus-visible:rounded-none focus-visible:outline-none",
                { "opacity-50": trade.quoteLoading && activelyEditedSide === 'to' }
              )}
              placeholder="0"
              disabled={isAttemptingSwitch}
            />
            <div className="relative text-right text-xs min-h-5">
              {/* USD Value - hide on hover */}
              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                "opacity-50": trade.quoteLoading && activelyEditedSide === 'to',
                "group-hover:opacity-0": isConnected && parseFloat(displayFromToken.balance || "0") > 0
              })}>
                {trade.formatCurrency((parseFloat(fromAmount || "0") * (fromTokenPrice.price || displayFromToken.usdPrice || 0)).toString())}
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
      </div>

      {/* Arrow button */}
      <div className={cn("flex justify-center relative", isMobile ? "min-h-[44px]" : "min-h-[32px]")}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes arrowGlare {
            from { background-position: 0% 0%; }
            to { background-position: 300% 0%; }
          }

          .arrow-loading-wrapper {
            position: absolute;
            left: calc(50% - 16px);
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: inherit;
            border-radius: 8px;
            overflow: visible;
          }

          /* Mobile: larger touch target (44px minimum) */
          .arrow-loading-wrapper.mobile-size {
            left: calc(50% - 22px);
            width: 44px;
            height: 44px;
            border-radius: 10px;
          }

          .arrow-loading-wrapper::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: 9px;
            background: linear-gradient(
              45deg,
              #f94706,
              #ff7919 30%,
              rgba(0, 0, 0, 0.4) 50%,
              #f94706 70%,
              #ff7919 100%
            );
            background-size: 300% 100%;
            opacity: 0;
            transition: opacity 0.5s ease-out;
            pointer-events: none;
            z-index: 0;
            animation: arrowGlare 1.5s linear infinite;
          }

          .arrow-loading-wrapper.mobile-size::before {
            border-radius: 11px;
          }

          .arrow-loading-wrapper.loading::before {
            opacity: 1;
          }

          .arrow-loading-inner {
            position: relative;
            width: 100%;
            height: 100%;
            border-radius: 8px;
            background: var(--surface-bg);
            border: 1px solid transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: border-color 0.2s ease;
            z-index: 1;
          }

          .arrow-loading-wrapper.mobile-size .arrow-loading-inner {
            border-radius: 10px;
          }

          .arrow-loading-wrapper:not(.loading):hover {
            cursor: pointer;
          }

          .arrow-loading-wrapper:not(.loading):hover .arrow-loading-inner {
            border-color: rgba(50, 50, 50, 0.6);
          }

          /* Mobile: active state for touch feedback */
          .arrow-loading-wrapper:not(.loading):active .arrow-loading-inner {
            border-color: rgba(70, 70, 70, 0.8);
            background: var(--muted);
          }

          .arrow-loading-wrapper.loading .arrow-loading-inner {
            border-color: transparent;
          }
        `}} />
        <div
          className={cn(
            "arrow-loading-wrapper",
            isMobile && "mobile-size",
            trade.quoteLoading && "loading",
            isAttemptingSwitch && "cursor-not-allowed"
          )}
          onClick={isAttemptingSwitch || trade.quoteLoading ? undefined : handleSwapTokens}
        >
          <div className="arrow-loading-inner">
            <ArrowDownIcon className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
          </div>
          <span className="sr-only">Swap tokens</span>
        </div>
      </div>

      {/* Buy Section */}
      <div className="mt-2">
        <div className="input-gradient-hover">
          <div
            className={cn(
              "relative z-[1] group rounded-lg bg-surface p-4 border transition-colors",
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
            {isConnected ? (isLoadingCurrentToTokenBalance ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" /> : displayToToken.balance) : "~"} {displayToToken.symbol}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* Token Selector - prevent keyboard popup on mobile by stopping propagation */}
          <div onClick={isMobile ? (e) => e.stopPropagation() : undefined}>
            <TokenSelector
              selectedToken={displayToToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onToTokenSelect}
              excludeToken={displayFromToken as TokenSelectorToken}
              disabled={isAttemptingSwitch}
              swapContainerRect={swapContainerRect}
            />
          </div>
          <div className="flex-1">
            <Input
              type={isMobile ? "number" : "text"}
              inputMode={isMobile ? "decimal" : undefined}
              step={isMobile ? "any" : undefined}
              value={toAmount}
              onChange={onToAmountChange}
              onFocus={() => setIsBuyInputFocused(true)}
              onBlur={() => setIsBuyInputFocused(false)}
              disabled={isAttemptingSwitch}
              className={cn(
                "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                { "opacity-50": trade.quoteLoading && activelyEditedSide === 'from' }
              )}
              placeholder="0"
            />
            <div className="relative text-right text-xs min-h-5">
              {/* USD Value - hide on hover */}
              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                "opacity-50": trade.quoteLoading && activelyEditedSide === 'from',
                "group-hover:opacity-0": isConnected && parseFloat(displayToToken.balance || "0") > 0
              })}>
                {(() => {
                  const amount = parseFloat(toAmount || "");
                  if (!toAmount || isNaN(amount)) return "$0.00";
                  return trade.formatCurrency((amount * (toTokenPrice.price || displayToToken.usdPrice || 0)).toString());
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
      </div>

      {/* Route, Fee, and Slippage Information */}
      <div className="mt-4 space-y-1.5">
        {showRoute && !!trade.routeInfo && (
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
                <span>Route</span>
              </div>

              <div className="flex items-center gap-3">
                {(() => {
                  const isMultiHop = (trade.routeInfo?.path?.length || 2) > 2;
                  if (!isMultiHop) return null;

                  const showDesktopSelection = !isMobile && clickedTokenIndex !== null;
                  return showDesktopSelection && trade.dynamicFeeBps !== null ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        {trade.quoteError ? (
                          "-"
                        ) : trade.quoteLoading ? (
                          <div className="h-3 w-8 bg-muted/60 rounded animate-pulse"></div>
                        ) : (
                          formatPercentFromBps(trade.dynamicFeeBps)
                        )}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* Animated token picker */}
                <div className="relative flex items-center h-7">
                  {(() => {
                    const path = trade.routeInfo?.path || [displayFromToken.symbol, displayToToken.symbol];
                    const iconSize = 20;
                    const overlap = 0.3 * iconSize;
                    const step = iconSize - overlap;

                    const pairMargin = 10;
                    const hoverMargin = 10;

                    const baseWidth = path.length > 0 ? iconSize + (path.length - 1) * step : 0;

                    const gaps: number[] = Array(Math.max(0, path.length - 1)).fill(0);

                    const rawPoolIndex = selectedPoolIndexForChart;
                    const poolIndex = Math.max(0, Math.min(rawPoolIndex, path.length - 2));
                    const showDesktopSelection = !isMobile && clickedTokenIndex !== null;
                    if (showDesktopSelection) {
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
                        {showDesktopSelection && (() => {
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

                          const isSelected = showDesktopSelection && (index === poolIndex || index === poolIndex + 1);

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
                    const poolsCount = (trade.routeInfo?.pools.length || Math.max(1, n - 1));
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
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isMobile) setClickedTokenIndex(index);

                                          const n = path.length;
                                          if (n >= 2 && onSelectPoolForChart) {
                                            const poolsCount = (trade.routeInfo?.pools.length || Math.max(1, n - 1));
                                            const maxPoolIdx = Math.max(0, poolsCount - 1);
                                            const poolStart = Math.max(0, Math.min(Math.min(index, n - 2), maxPoolIdx));

                                            committedPoolIndexRef.current = poolStart;
                                            onSelectPoolForChart(poolStart);

                                            if (!hoverPreviewActiveRef.current) {
                                              hoverPreviewActiveRef.current = true;
                                              onRouteHoverChange?.(true);
                                            }
                                          }
                                        }}
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
                  {(() => {
                    const isMultiHop = (trade.routeInfo?.path?.length || 2) > 2;
                    if (isMultiHop) {
                      return (
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>Fee</span>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8} className="px-2 py-1 text-xs max-w-xs">
                              <p>Total fee for this multi-hop swap.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    }
                    return <span>Fee</span>;
                  })()}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {(() => {
                      if (trade.quoteError) {
                        return <span className="text-muted-foreground">-</span>;
                      }
                      if (trade.quoteLoading) {
                        return <div className="h-3 w-16 bg-muted/60 rounded animate-pulse"></div>;
                      }
                      if (trade.dynamicFeeBps === null) {
                        return <span className="text-muted-foreground">N/A</span>;
                      }
                      const inputAmountUSD = parseFloat(fromAmount || "0") * (fromTokenPrice.price || displayFromToken.usdPrice || 0);
                      const feeInUSD = inputAmountUSD * (trade.dynamicFeeBps / 10000);
                      const percentDisplay = formatPercentFromBps(trade.dynamicFeeBps);
                      const amountDisplay = feeInUSD > 0 && feeInUSD < 0.01 ? "< $0.01" : trade.formatCurrency(feeInUSD.toString());

                      return (
                        <div className="relative inline-flex items-center justify-end h-5 group cursor-default">
                          <span className="text-muted-foreground transition-opacity duration-150 group-hover:opacity-0 leading-none cursor-default text-right whitespace-nowrap">{percentDisplay}</span>
                          <span className="absolute right-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 whitespace-nowrap leading-none cursor-default text-right">{amountDisplay}</span>
                        </div>
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

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Minimum Received</span>
                  <span className="text-muted-foreground">
                    {trade.calculatedValues.minimumReceived} {displayToToken.symbol}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Warning Cards - compact card style with tinted bg, border, icon container */}
      {/* Price Impact Warning */}
      {trade.priceImpactWarning && (() => {
        const isHigh = trade.priceImpactWarning.severity === 'high';
        const isLoading = trade.quoteLoading;
        const color = isHigh ? '#FF593C' : '#FFBF17';
        const bgColor = isHigh ? 'rgba(255, 89, 60, 0.08)' : 'rgba(255, 191, 23, 0.08)';
        const borderColor = isHigh ? 'rgba(255, 89, 60, 0.2)' : 'rgba(255, 191, 23, 0.2)';
        const borderHoverColor = isHigh ? 'rgba(255, 89, 60, 0.4)' : 'rgba(255, 191, 23, 0.4)';
        const iconBgColor = isHigh ? 'rgba(255, 89, 60, 0.12)' : 'rgba(255, 191, 23, 0.12)';
        return (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg border p-2 transition-colors"
            style={{ backgroundColor: bgColor, borderColor }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = borderHoverColor; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; }}
          >
            <div
              className="flex items-center justify-center p-1.5 rounded-md shrink-0"
              style={{ backgroundColor: iconBgColor }}
            >
              <IconTriangleWarningFilled className="h-3.5 w-3.5" style={{ color }} />
            </div>
            {isLoading ? (
              <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: iconBgColor }} />
            ) : (
              <span className="text-xs font-medium" style={{ color }}>
                {trade.priceImpactWarning.message}
              </span>
            )}
          </div>
        );
      })()}

      {/* Slippage Warning */}
      {showSlippageWarning && !isAutoSlippage && slippageWarningMessage && (() => {
        const isHigh = isSlippageCritical;
        const color = isHigh ? '#FF593C' : '#FFBF17';
        const bgColor = isHigh ? 'rgba(255, 89, 60, 0.08)' : 'rgba(255, 191, 23, 0.08)';
        const borderColor = isHigh ? 'rgba(255, 89, 60, 0.2)' : 'rgba(255, 191, 23, 0.2)';
        const borderHoverColor = isHigh ? 'rgba(255, 89, 60, 0.4)' : 'rgba(255, 191, 23, 0.4)';
        const iconBgColor = isHigh ? 'rgba(255, 89, 60, 0.12)' : 'rgba(255, 191, 23, 0.12)';
        return (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg border p-2 transition-colors"
            style={{ backgroundColor: bgColor, borderColor }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = borderHoverColor; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; }}
          >
            <div
              className="flex items-center justify-center p-1.5 rounded-md shrink-0"
              style={{ backgroundColor: iconBgColor }}
            >
              <IconTriangleWarningFilled className="h-3.5 w-3.5" style={{ color }} />
            </div>
            <span className="text-xs font-medium" style={{ color }}>
              {slippageWarningMessage}
            </span>
          </div>
        );
      })()}

      {/* Price Deviation Warning */}
      {priceDeviation && priceDeviation.severity !== 'none' && (
        <div className="mt-3">
          <PriceDeviationCallout
            deviation={priceDeviation}
            token0Symbol={displayFromToken.symbol}
            token1Symbol={displayToToken.symbol}
            variant="card"
            isQuoteLoading={trade.quoteLoading}
          />
        </div>
      )}

      <div className="mt-4 h-10">
        {!isMounted ? null : isConnected ? (
          currentChainId !== TARGET_CHAIN_ID && onNetworkSwitch ? (
            <Button
              className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              onClick={onNetworkSwitch}
            >
              {actionButtonText}
            </Button>
          ) : (
            <Button
              className={cn(
                "w-full",
                isSwapBaseDisabled
                  ? "relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 text-white/75"
                  : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary",
                isSwapBaseDisabled ? (trade.quoteLoading ? "cursor-wait" : "cursor-default") : null
              )}
              onClick={handleSwap}
              disabled={isSwapDisabled}
              aria-busy={trade.quoteLoading}
              style={isSwapBaseDisabled ? { backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              {actionButtonText}
            </Button>
          )
        ) : (
          <div
            className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
            style={{ backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
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
