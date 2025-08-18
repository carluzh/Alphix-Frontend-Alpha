"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowDownIcon,
  ChevronRightIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

  const presetSlippages = [0.5, 2, 5];
  
  const handleSlippageSelect = (value: number) => {
    onSlippageChange(value);
    setIsSlippageEditing(false);
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
      setIsSlippageEditing(false);
      setIsCustomSlippage(false);
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

  // Handle clicks outside the slippage editor to close it
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (slippageRef.current && !slippageRef.current.contains(event.target as Node)) {
        setIsSlippageEditing(false);
        setIsCustomSlippage(false);
        setCustomSlippage("");
      }
    };

    if (isSlippageEditing) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
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
        <div 
          className={cn(
            "rounded-lg bg-[var(--token-container-background)] p-4 border transition-colors hover:border-[var(--token-container-border-hover)]",
            isSellInputFocused
              ? "border-[var(--token-container-border-hover)]"
              : "border-transparent"
          )}
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
                onChange={handleFromAmountChange}
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
        </div>
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" size="icon" className="rounded-full bg-muted/30 z-10 h-8 w-8" onClick={handleSwapTokens} disabled={!isConnected || isAttemptingSwitch}>
          <ArrowDownIcon className="h-4 w-4" />
          <span className="sr-only">Swap tokens</span>
        </Button>
      </div>

      {/* Buy Section - Uses `displayToToken` */}
      <div className="mb-6 mt-2">
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
              {quoteError ? (
                <Input
                  value="0"
                  readOnly
                  disabled={!isConnected || isAttemptingSwitch}
                  className="text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent text-muted-foreground"
                  placeholder="0.00"
                />
              ) : (
                <>
                  <Input
                    value={(() => {
                      const amount = parseFloat(toAmount || "0");
                      // Show placeholder "0" for true zero values or when there's no meaningful amount
                      if (amount === 0 || isNaN(amount)) {
                        return "";
                      }
                      return amount.toFixed(displayToToken.displayDecimals);
                    })()}
                    readOnly
                    disabled={!isConnected || isAttemptingSwitch}
                    className={cn(
                      "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                      { "text-muted-foreground animate-pulse": quoteLoading }
                    )}
                    placeholder="0"
                  />
                  <div className={cn(
                    "text-right text-xs text-muted-foreground",
                    { "animate-pulse": quoteLoading }
                  )}>
                    {(() => {
                      const amount = parseFloat(toAmount || "0");
                      if (amount === 0 || isNaN(amount)) {
                        return formatCurrency("0");
                      }
                      return formatCurrency((amount * displayToToken.usdPrice).toString());
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Route, Fee, and Slippage Information */}
      {/* Route can be toggled via showRoute */}
      <div className="mt-3 mb-1 space-y-1.5">
        {showRoute && isConnected && currentChainId === TARGET_CHAIN_ID && (
          <>
            {/* NEW: Animated Route Display */}
            <div
              className="flex items-center justify-between text-xs text-muted-foreground"
              onMouseLeave={() => setHoveredRouteIndex(null)}
            >
              <span>Route:</span>
              <div className="relative flex items-center h-7">
                {(() => {
                  const path = routeInfo?.path || [displayFromToken.symbol, displayToToken.symbol];
                  
                  const iconSize = 20;
                  const overlap = 0.3 * iconSize; // 30% overlap
                  const step = iconSize - overlap;
                  const feeWidth = 40;
                  const totalWidth = iconSize + (path.length - 1) * step; // Remove feeWidth from container width

                  return (
                    <div className="absolute right-0" style={{ width: totalWidth, height: iconSize }}>
                      {path.map((tokenSymbol, index) => {
                        const tokenConfig = getToken(tokenSymbol);
                        const tokenIcon = tokenConfig?.icon || "/placeholder-logo.svg";
                        // Fee for the pool OUTGOING from this token (to the next one)
                        const fee = (routeFees && index < routeFees.length)
                          ? `${(routeFees[index].fee / 10000).toFixed(2)}%`
                          : null;

                        const isHovered = hoveredRouteIndex === index;
                        const isRightmost = index === path.length - 1;
                        
                        // Default stacked positions from left to right, container anchored to the right
                        const leftPos = index * step;
                        
                        // Simple approach: create equal spacing around hovered token
                        let xOffset = 0;
                        if (hoveredRouteIndex !== null && hoveredRouteIndex < path.length - 1) {
                          const margin = 10; // Predefined margin (increased by 25%)
                          
                          if (index === hoveredRouteIndex) {
                            // Hovered token moves left by margin
                            xOffset = -margin;
                          } else if (index < hoveredRouteIndex) {
                            // Tokens to the left move left by double margin (to create parallel spacing)
                            xOffset = -(margin * 2);
                          }
                          // Tokens to the right (index > hoveredRouteIndex) don't move (xOffset = 0)
                        }

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
                            onHoverStart={() => setHoveredRouteIndex(index)}
                            onHoverEnd={() => setHoveredRouteIndex(null)}
                          >
                            <div className="flex items-center">
                              {/* Icon */}
                                                              <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <motion.div
                                        className="relative"
                                        whileHover={{ scale: 1.08 }}
                                        style={{ 
                                          padding: `${iconSize * 0.1}px`,
                                          margin: `-${iconSize * 0.1}px`
                                        }}
                                      >
                                        <Image 
                                          src={tokenIcon} 
                                          alt={tokenSymbol} 
                                          width={iconSize} 
                                          height={iconSize} 
                                          className="rounded-full bg-background"
                                          style={{ boxShadow: '0 0 0 2px var(--background)' }}
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
                    </div>
                  );
                })()}
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
                      if (routeFeesLoading) {
                        return <div className="h-3 w-12 bg-muted/60 rounded animate-pulse"></div>;
                      }
                      if (!routeFees || routeFees.length === 0) {
                        return <span className="text-muted-foreground">N/A</span>;
                      }
                      const totalFeeBps = routeFees.reduce((total, routeFee) => total + routeFee.fee, 0);
                      const inputAmountUSD = parseFloat(fromAmount || "0") * (displayFromToken.usdPrice || 0);
                      const feeInUSD = inputAmountUSD * (totalFeeBps / 1000000);
                      return <span className="text-foreground/80 font-medium">{formatCurrency(feeInUSD.toString())}</span>;
                    })()}
                  </div>
                </div>
                {/* Minimum Received and Slippage */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <span>Minimum Received:</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5" ref={slippageRef}>
                          {!isSlippageEditing ? (
                            <span 
                              className="text-foreground/80 font-medium cursor-pointer hover:underline transition-all duration-200"
                              onClick={() => {
                                setIsSlippageEditing(true);
                                setCustomSlippage(slippage.toString()); // Pre-fill with current slippage
                              }}
                            >
                              {slippage}%
                            </span>
                          ) : (
                            <div className="flex items-center gap-1 outline outline-1 outline-muted rounded">
                              <input
                                type="text"
                                value={customSlippage}
                                onChange={handleCustomSlippageInput}
                                onKeyDown={handleCustomSlippageKeyDown}
                                onBlur={handleCustomSlippageSubmit}
                                placeholder="0.00"
                                className="w-12 px-1 py-0.5 text-xs text-center bg-background border-none focus:outline-none focus:ring-0 focus-visible:ring-offset-0"
                                autoFocus
                              />
                              <span className="text-xs">%</span>
                            </div>
                          )}
                        </div>
                        <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-foreground/80 font-medium">
                            {calculatedValues.minimumReceived} {displayToToken.symbol}
                        </span>
                    </div>
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
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
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