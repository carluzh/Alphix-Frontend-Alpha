"use client";

import React from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import {
  ArrowDownIcon,
  ChevronRightIcon,
  ChevronsRight,
} from "lucide-react";
import { TokenImage } from '@/components/ui/token-image';
import { IconTriangleWarningFilled } from "nucleo-micro-bold-essential";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Token } from './swap-interface';
import { TokenSelector, TokenSelectorToken } from './TokenSelector';
import { getToken } from '@/lib/pools-config';
import { searchTokens } from '@/lib/aggregators';
import { SlippageControl } from './SlippageControl';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { useSlippageValidation } from '@/hooks/useSlippage';
import { useIsMobile } from "@/hooks/use-mobile";
import type { SwapTradeModel } from "./useSwapTrade";
import type { PriceDeviationResult } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout } from "@/components/ui/PriceDeviationCallout";
import { appKit } from "@/components/AppKitProvider";

interface SwapInputViewProps {
  displayFromToken: Token | null;
  displayToToken: Token | null;
  fromAmount: string;
  toAmount: string;
  handleFromAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activelyEditedSide: 'from' | 'to';
  handleSwapTokens: () => void;
  handleUsePercentage: (percentage: number, isFrom: boolean) => void;
  availableTokens: Token[];
  onFromTokenSelect: (token: TokenSelectorToken) => void;
  onToTokenSelect: (token: TokenSelectorToken) => void;
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
  fromTokenRawBalance?: string;
  fromSelectorOpen: boolean;
  toSelectorOpen: boolean;
  onFromSelectorOpenChange: (open: boolean) => void;
  onToSelectorOpenChange: (open: boolean) => void;
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
  fromTokenRawBalance,
  fromSelectorOpen,
  toSelectorOpen,
  onFromSelectorOpenChange,
  onToSelectorOpenChange,
}: SwapInputViewProps) {
  const isMobile = useIsMobile();
  const [hoveredPoolIndex, setHoveredPoolIndex] = React.useState<number | null>(null);
  const [balanceWiggleCount, setBalanceWiggleCount] = React.useState(0);
  const [isSellInputFocused, setIsSellInputFocused] = React.useState(false);
  const [isBuyInputFocused, setIsBuyInputFocused] = React.useState(false);
  const wiggleControls = useAnimation();

  // Dynamic cursor: pointer on left half, default on right half
  const sellCardRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sellCardRef.current;
    if (!el) return;
    const handleMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width * 0.5;
      el.style.cursor = isLeft ? 'pointer' : 'default';
      el.classList.toggle('hover-left', isLeft);
      el.classList.toggle('hover-right', !isLeft);
    };
    const handleLeave = () => {
      el.classList.remove('hover-left', 'hover-right');
    };
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerleave', handleLeave);
    return () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
    };
  });

  const swapInputPriceSymbols = React.useMemo(
    () => [displayFromToken?.symbol, displayToToken?.symbol].filter(Boolean) as string[],
    [displayFromToken?.symbol, displayToToken?.symbol]
  );
  const { prices: swapInputPrices } = useTokenPrices(swapInputPriceSymbols);
  const fromTokenPrice = { price: displayFromToken ? (swapInputPrices[displayFromToken.symbol] || null) : null };
  const toTokenPrice = { price: displayToToken ? (swapInputPrices[displayToToken.symbol] || null) : null };
  const { showWarning: showSlippageWarning, warningMessage: slippageWarningMessage, isCritical: isSlippageCritical } = useSlippageValidation(slippage);

  const formatPercentFromBps = React.useCallback((bps: number) => {
    const percent = bps / 100;
    const decimals = percent < 0.1 ? 3 : 2;
    return `${percent.toFixed(decimals)}%`;
  }, []);

  // Removed: onSelectPoolForChart(0) on mount — segment 0 is now the Route preview by default

  React.useEffect(() => {
    if (balanceWiggleCount > 0) {
      wiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount, wiggleControls]);

  const handleFromAmountChangeWithWiggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (displayFromToken) {
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
    }
    handleFromAmountChange(e);
  };

  const swapDisabledDueToBalance = displayFromToken
    ? parseFloat(fromAmount || "0") > 0 &&
      (
        isNaN(parseFloat(displayFromToken.balance || "0")) ||
        parseFloat(fromTokenRawBalance || displayFromToken.balance || "0") < parseFloat(fromAmount || "0") * 0.999999
      )
    : false;

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
      <div>
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
          /* Grid texture hover overlay for token selector zone */
          .swap-card-grid-hover {
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            z-index: 0;
            background-image: radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1px);
            background-size: 16px 16px;
            -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 55%);
            mask-image: linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 55%);
          }
          .swap-card.hover-left .swap-card-grid-hover {
            opacity: 1;
          }
          .swap-pct-container,
          .swap-pct-btn {
            opacity: 0;
            transform: translateY(-0.25rem);
          }
          .swap-card.hover-right .swap-pct-container,
          .swap-card.hover-right .swap-pct-btn {
            opacity: 1;
            transform: translateY(0);
          }
          .swap-card.hover-right .swap-usd-fade {
            opacity: 0;
          }
        `}} />
        {displayFromToken ? (
          <div className="input-gradient-hover">
          {/* Token selected: normal layout */}
          <motion.div
            ref={sellCardRef}
            className={cn(
              "relative z-[1] group swap-card rounded-lg bg-surface p-4 border transition-colors overflow-hidden",
              isSellInputFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
            )}
            animate={wiggleControls}
            style={{ cursor: 'default' }}
            onClick={(e) => {
              // Open token selector when clicking on the left side of the card (outside the input)
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const isLeftSide = clickX < rect.width * 0.5;
              if (isLeftSide && !isAttemptingSwitch) {
                onFromSelectorOpenChange(true);
              }
            }}
          >
            {/* Grid texture hover overlay — left half fade */}
            <div className="swap-card-grid-hover" />
            <div className="flex items-center justify-between mb-2 relative z-[1]">
              <Label className="text-sm font-medium">Sell</Label>
              <>
                {isMobile && onClearFromAmount && fromAmount.length > 0 ? (
                  <button
                    type="button"
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); onClearFromAmount?.(); }}
                  >
                    Clear
                  </button>
                ) : (
                  <Button
                    variant="ghost"
                    className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                    onClick={(e) => { e.stopPropagation(); handleUsePercentage(100, true); }}
                    disabled={!isConnected}
                  >
                    {isConnected ? (isLoadingCurrentFromTokenBalance ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" /> : displayFromToken.balance) : "~"} {displayFromToken.symbol}
                  </Button>
                )}
              </>
            </div>

            <div className="flex items-center gap-2 relative z-[1]">
              {/* Left zone: token image + name */}
              <div
                className={cn(
                  "flex items-center gap-2 shrink-0",
                  { "opacity-50": isAttemptingSwitch }
                )}
              >
                <TokenImage
                  src={displayFromToken.icon || '/placeholder-logo.svg'}
                  alt={displayFromToken.symbol}
                  size={28}
                />
                <span className="text-base font-medium">{displayFromToken.symbol}</span>
              </div>
              {/* Hidden TokenSelector for the modal */}
              <TokenSelector
                selectedToken={displayFromToken as TokenSelectorToken}
                availableTokens={availableTokens as TokenSelectorToken[]}
                onTokenSelect={onFromTokenSelect}
                excludeToken={displayToToken as TokenSelectorToken || undefined}
                disabled={isAttemptingSwitch}
                swapContainerRect={swapContainerRect}
                isOpen={fromSelectorOpen}
                onOpenChange={onFromSelectorOpenChange}
                className="hidden"
              />
              {/* Right zone: amount input */}
              <div className="flex-1 max-w-[50%] ml-auto" onClick={(e) => e.stopPropagation()}>
                <Input
                  type={isMobile ? "number" : "text"}
                  inputMode={isMobile ? "decimal" : undefined}
                  step={isMobile ? "any" : undefined}
                  value={fromAmount}
                  onChange={handleFromAmountChangeWithWiggle}
                  maxLength={16}
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
                  <div className={cn("text-muted-foreground transition-opacity duration-100", {
                    "opacity-50": trade.quoteLoading && activelyEditedSide === 'to',
                    "swap-usd-fade": isConnected && parseFloat(displayFromToken.balance || "0") > 0
                  })}>
                    {trade.formatCurrency((parseFloat(fromAmount || "0") * (fromTokenPrice.price || displayFromToken.usdPrice || 0)).toString())}
                  </div>
                  {isConnected && parseFloat(displayFromToken.balance || "0") > 0 && (
                    <div className="absolute right-0 top-[3px] flex gap-1 swap-pct-container transition-all duration-100">
                      {[25, 50, 75, 100].map((percentage, index) => (
                        <motion.div
                          key={percentage}
                          className="swap-pct-btn"
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
        ) : (
          /* No token selected: plain border hover, no gradient */
          <motion.div
            className="rounded-lg bg-surface p-4 border border-sidebar-border/60 hover:border-muted-foreground/40 transition-colors cursor-pointer"
            onClick={() => onFromSelectorOpenChange(true)}
            animate={wiggleControls}
          >
            {/* Header row — matches token-selected layout */}
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium pointer-events-none">Select Token</Label>
              <span className="h-3 w-20 bg-muted/40 rounded inline-block" />
            </div>

            <div className="flex items-center gap-2">
              {/* Left: skeleton token icon + name */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-muted/50 shrink-0" />
                <div className="w-14 h-5 rounded bg-muted/50" />
              </div>
              {/* Right: skeleton amount + USD sub-row */}
              <div className="flex-1">
                <div className="flex justify-end">
                  <span className="h-6 w-16 bg-muted/40 rounded inline-block" />
                </div>
                <div className="flex justify-end mt-1.5">
                  <span className="h-3 w-10 bg-muted/30 rounded inline-block" />
                </div>
              </div>
            </div>

            {/* Hidden TokenSelector for the modal */}
            <TokenSelector
              selectedToken={null}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onFromTokenSelect}
              excludeToken={displayToToken as TokenSelectorToken || undefined}
              disabled={isAttemptingSwitch}
              swapContainerRect={swapContainerRect}
              isOpen={fromSelectorOpen}
              onOpenChange={onFromSelectorOpenChange}
              className="hidden"
            />
          </motion.div>
        )}
      </div>

      {/* Arrow button — overlaps both Sell and Buy cards (Uniswap-style) */}
      <div className="flex justify-center relative z-10" style={{ height: 0 }}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes arrowGlare {
            from { background-position: 0% 0%; }
            to { background-position: 300% 0%; }
          }

          /* Outer ring: background-colored mask that creates the cutout */
          .arrow-cutout-ring {
            position: absolute;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: var(--swap-background, var(--card));
            padding: 4px;
            /* Center between Sell bottom (0) and Buy top (+8): midpoint = 4 */
            /* Half-height = (32 + 4*2) / 2 = 20, so top = 4 - 20 = -16 */
            top: -16px;
          }
          .arrow-cutout-ring.mobile-size {
            border-radius: 14px;
            /* Half-height = (44 + 4*2) / 2 = 26, so top = 4 - 26 = -22 */
            top: -22px;
          }

          .arrow-loading-wrapper {
            position: relative;
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
            border: 1px solid rgba(50, 50, 50, 0.6);
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
            border-color: rgba(80, 80, 80, 0.8);
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
        <div className={cn("arrow-cutout-ring", isMobile && "mobile-size")}>
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
      </div>

      {/* Buy Section — arrow overlaps into both cards */}
      <div style={{ marginTop: 8 }}>
        {displayToToken ? (
          <div className="input-gradient-hover">
            {/* Token selected: normal layout */}
            <div
              className={cn(
                "relative z-[1] group swap-card rounded-lg bg-surface p-4 border transition-colors overflow-hidden",
                isBuyInputFocused ? "border-sidebar-primary" : "border-sidebar-border/60"
              )}
              style={{ cursor: 'default' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const isLeftSide = clickX < rect.width * 0.5;
                if (isLeftSide && !isAttemptingSwitch) {
                  onToSelectorOpenChange(true);
                }
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const isLeft = (e.clientX - rect.left) < rect.width * 0.5;
                e.currentTarget.style.cursor = isLeft ? 'pointer' : 'default';
                e.currentTarget.classList.toggle('hover-left', isLeft);
                e.currentTarget.classList.toggle('hover-right', !isLeft);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.classList.remove('hover-left', 'hover-right');
              }}
            >
              {/* Grid texture hover overlay — left half fade */}
              <div className="swap-card-grid-hover" />
              <div className="flex items-center justify-between mb-2 relative z-[1]">
                <Label className="text-sm font-medium">Buy</Label>
                <Button
                  variant="ghost"
                  className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
                  onClick={(e) => { e.stopPropagation(); handleUsePercentage(100, false); }}
                  disabled={!isConnected}
                >
                  {isConnected ? (isLoadingCurrentToTokenBalance ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" /> : displayToToken.balance) : "~"} {displayToToken.symbol}
                </Button>
              </div>

              <div className="flex items-center gap-2 relative z-[1]">
                {/* Left zone: token image + name */}
                <div
                  className={cn(
                    "flex items-center gap-2 shrink-0",
                    { "opacity-50": isAttemptingSwitch }
                  )}
                >
                  <TokenImage
                    src={displayToToken.icon || '/placeholder-logo.svg'}
                    alt={displayToToken.symbol}
                    size={28}
                  />
                  <span className="text-base font-medium">{displayToToken.symbol}</span>
                </div>
                {/* Hidden TokenSelector for the modal */}
                <TokenSelector
                  selectedToken={displayToToken as TokenSelectorToken}
                  availableTokens={availableTokens as TokenSelectorToken[]}
                  onTokenSelect={onToTokenSelect}
                  excludeToken={displayFromToken as TokenSelectorToken || undefined}
                  disabled={isAttemptingSwitch}
                  swapContainerRect={swapContainerRect}
                  isOpen={toSelectorOpen}
                  onOpenChange={onToSelectorOpenChange}
                  className="hidden"
                />
                <div className="flex-1 max-w-[50%] ml-auto" onClick={(e) => e.stopPropagation()}>
                  <Input
                    type={isMobile ? "number" : "text"}
                    inputMode={isMobile ? "decimal" : undefined}
                    step={isMobile ? "any" : undefined}
                    value={toAmount}
                    onChange={onToAmountChange}
                    onFocus={() => setIsBuyInputFocused(true)}
                    onBlur={() => setIsBuyInputFocused(false)}
                    disabled={isAttemptingSwitch}
                    maxLength={16}
                    className={cn(
                      "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                      { "opacity-50": trade.quoteLoading && activelyEditedSide === 'from' }
                    )}
                    placeholder="0"
                  />
                  <div className="relative text-right text-xs min-h-5">
                    <div className={cn("text-muted-foreground transition-opacity duration-100", {
                      "opacity-50": trade.quoteLoading && activelyEditedSide === 'from',
                      "swap-usd-fade": isConnected && parseFloat(displayToToken.balance || "0") > 0
                    })}>
                      {(() => {
                        const amount = parseFloat(toAmount || "");
                        if (!toAmount || isNaN(amount)) return "$0.00";
                        return trade.formatCurrency((amount * (toTokenPrice.price || displayToToken.usdPrice || 0)).toString());
                      })()}
                    </div>
                    {isConnected && parseFloat(displayToToken.balance || "0") > 0 && (
                      <div className="absolute right-0 top-[3px] flex gap-1 swap-pct-container transition-all duration-100">
                        {[25, 50, 75, 100].map((percentage, index) => (
                          <motion.div
                            key={percentage}
                            className="swap-pct-btn"
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
        ) : (
          /* No token selected: plain border hover, no gradient */
          <div
            className="rounded-lg bg-surface p-4 border border-sidebar-border/60 hover:border-muted-foreground/40 transition-colors cursor-pointer"
            onClick={() => onToSelectorOpenChange(true)}
          >
            {/* Header row — matches token-selected layout */}
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium pointer-events-none">Select Token</Label>
              <span className="h-3 w-20 bg-muted/40 rounded inline-block" />
            </div>

            <div className="flex items-center gap-2">
              {/* Left: skeleton token icon + name */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-muted/50 shrink-0" />
                <div className="w-14 h-5 rounded bg-muted/50" />
              </div>
              {/* Right: skeleton amount + USD sub-row */}
              <div className="flex-1">
                <div className="flex justify-end">
                  <span className="h-6 w-16 bg-muted/40 rounded inline-block" />
                </div>
                <div className="flex justify-end mt-1.5">
                  <span className="h-3 w-10 bg-muted/30 rounded inline-block" />
                </div>
              </div>
            </div>

            <TokenSelector
              selectedToken={null}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onToTokenSelect}
              excludeToken={displayFromToken as TokenSelectorToken || undefined}
              disabled={isAttemptingSwitch}
              swapContainerRect={swapContainerRect}
              isOpen={toSelectorOpen}
              onOpenChange={onToSelectorOpenChange}
              className="hidden"
            />
          </div>
        )}
      </div>

      {/* Route, Fee, and Slippage Information */}
      <div className="mt-4 space-y-1.5">
        {showRoute && !!trade.routeInfo && !!displayFromToken && !!displayToToken && (
          <>
            {/* Kyberswap trades: simple route indicator (no interactive pool picker) */}
            {trade.source === "kyberswap" ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>Route</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TokenImage src={displayFromToken!.icon} alt={displayFromToken!.symbol} size={18} className="bg-background" />
                  <ChevronsRight className="h-3 w-3 text-muted-foreground/50" />
                  <TokenImage src={displayToToken!.icon} alt={displayToToken!.symbol} size={18} className="bg-background" />
                </div>
              </div>
            ) : (
            <div
              className="flex items-center justify-between text-xs text-muted-foreground"
              onMouseLeave={() => {
                setHoveredPoolIndex(null);
                onRouteHoverChange?.(false);
              }}
            >
              <div className="flex items-center gap-2">
                <span>Route</span>
              </div>

              <div className="flex items-center gap-3">
                {/* Token picker */}
                <div className="relative flex items-center h-7">
                  {(() => {
                    const path = trade.routeInfo?.path || [displayFromToken!.symbol, displayToToken!.symbol];
                    const iconSize = 20;
                    const step = iconSize * 0.7;
                    const pairGap = 10;
                    const poolCount = Math.max(1, path.length - 1);
                    const hp = hoveredPoolIndex !== null ? Math.min(hoveredPoolIndex, path.length - 2) : null;

                    // Compute gap between each adjacent token pair
                    const gaps = Array(Math.max(0, path.length - 1)).fill(0);
                    if (hp !== null && !isMobile) {
                      if (hp > 0) gaps[hp - 1] = pairGap;
                      if (hp < path.length - 2) gaps[hp + 1] = pairGap;
                    }

                    // Cumulative x-offsets from gaps
                    const off = [0];
                    for (let i = 1; i < path.length; i++) off[i] = off[i - 1] + gaps[i - 1];
                    const totalW = iconSize + (path.length - 1) * step + off[path.length - 1];

                    // Mouse move → find nearest token → derive pool
                    const onMove = (e: React.MouseEvent) => {
                      if (isMobile || path.length < 3) return;
                      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                      let best = 0, bestD = Infinity;
                      for (let i = 0; i < path.length; i++) {
                        const d = Math.abs(x - (i * step + off[i] + iconSize / 2));
                        if (d < bestD) { bestD = d; best = i; }
                      }
                      // Skip if nearest token is within the current grouped pair
                      if (hp !== null && (best === hp || best === hp + 1)) return;
                      const pool = Math.min(best, poolCount - 1);
                      if (pool !== hoveredPoolIndex) {
                        setHoveredPoolIndex(pool);
                        onSelectPoolForChart?.(pool);
                        onRouteHoverChange?.(true);
                      }
                    };

                    // Ring geometry
                    const ring = hp !== null && !isMobile ? (() => {
                      const pad = 3;
                      const l = hp * step + off[hp] - pad;
                      const r = (hp + 1) * step + off[hp + 1] + iconSize + pad;
                      const h = iconSize + pad * 2;
                      return { x: l, y: -pad, w: r - l, h };
                    })() : null;

                    return (
                      <div onMouseMove={onMove} className="relative" style={{ height: iconSize }}>
                      <motion.div
                        className="relative"
                        style={{ height: iconSize }}
                        animate={{ width: totalW }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      >
                        {ring && (
                          <motion.div
                            className="absolute"
                            initial={false}
                            animate={{ x: ring.x, y: ring.y, width: ring.w, height: ring.h }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            style={{ pointerEvents: 'none', zIndex: 0 }}
                          >
                            <svg width="100%" height="100%">
                              <rect x=".5" y=".5" width="calc(100% - 1px)" height="calc(100% - 1px)"
                                rx={ring.h / 2} fill="var(--sidebar-connect-button-bg)"
                                stroke="white" strokeWidth="1" strokeOpacity={0.3} />
                            </svg>
                          </motion.div>
                        )}
                        {path.map((sym, i) => {
                          const icon = i === 0 ? displayFromToken!.icon
                            : i === path.length - 1 ? displayToToken!.icon
                            : getToken(sym)?.icon || (() => {
                                const m = searchTokens(sym, 1).find(t => t.symbol.toLowerCase() === sym.toLowerCase());
                                return m?.logoURI || "/placeholder-logo.svg";
                              })();

                          return (
                            <motion.div
                              key={sym}
                              className="absolute top-0"
                              style={{ zIndex: i + 1, left: i * step }}
                              animate={{ x: off[i] }}
                              transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            >
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="cursor-pointer">
                                      <TokenImage src={icon} alt={sym} size={iconSize} className="bg-background" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{sym}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            )}

            {parseFloat(fromAmount || "0") > 0 && (
              <div className="py-0.5">
                <div className="border-t border-dashed border-muted-foreground/20" />
              </div>
            )}

            {parseFloat(fromAmount || "0") > 0 && (
              <div className="space-y-1.5">
                {trade.source !== "kyberswap" && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Fee</span>
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
                        const inputAmountUSD = parseFloat(fromAmount || "0") * (fromTokenPrice.price || displayFromToken?.usdPrice || 0);
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
                )}

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
                    {trade.calculatedValues.minimumReceived} {displayToToken?.symbol}
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
            token0Symbol={displayFromToken?.symbol ?? ""}
            token1Symbol={displayToToken?.symbol ?? ""}
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
          <button
            type="button"
            onClick={() => appKit?.open()}
            className="flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
            style={{ backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            {actionButtonText}
          </button>
        )}
      </div>
    </motion.div>
  );
}
