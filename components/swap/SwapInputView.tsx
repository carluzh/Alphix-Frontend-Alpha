"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowDownIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Token, FeeDetail, OutlineArcIcon } from './swap-interface';

interface SwapInputViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  fromAmount: string;
  toAmount: string;
  handleFromAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSwapTokens: () => void;
  handleUseFullBalance: (token: Token, isFrom: boolean) => void;
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
}

export function SwapInputView({
  displayFromToken,
  displayToToken,
  fromAmount,
  toAmount,
  handleFromAmountChange,
  handleSwapTokens,
  handleUseFullBalance,
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
}: SwapInputViewProps) {
  return (
    <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }}>
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
        <div className={cn("rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted", { "outline outline-1 outline-muted": isSellInputFocused })}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
              <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={20} height={20} className="rounded-full"/>
              <span className="text-sm">{displayFromToken.symbol}</span>
            </div>
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
        <div className="rounded-lg bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
              <Image src={displayToToken.icon} alt={displayToToken.symbol} width={20} height={20} className="rounded-full" />
              <span className="text-sm font-medium">{displayToToken.symbol}</span>
            </div>
            <div className="flex-1">
              {quoteError ? (
                <div className="text-right text-xl md:text-xl font-medium text-red-500 h-auto p-0">
                  Error: {quoteError}
                </div>
              ) : (
                <>
                  <Input
                    value={
                      parseFloat(toAmount || "0") === 0
                        ? "0"
                        : parseFloat(toAmount || "0").toFixed(displayToToken.symbol === 'BTCRL' ? 8 : 2)
                    }
                    readOnly
                    disabled={!isConnected || isAttemptingSwitch}
                    className={cn(
                      "text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent",
                      { "text-muted-foreground animate-pulse": quoteLoading }
                    )}
                    placeholder="0.00"
                  />
                  <div className={cn(
                    "text-right text-xs text-muted-foreground",
                    { "animate-pulse": quoteLoading }
                  )}>
                    {formatCurrency((parseFloat(toAmount || "0") * displayToToken.usdPrice).toString())}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fee Information - Shows if connected on target chain */}
      {isConnected && currentChainId === TARGET_CHAIN_ID && (
        <div className="space-y-1 text-sm mt-3">
          {calculatedValues.fees.map((fee, index) => (
            <div key={index} className="flex items-center justify-between">
              <span className={cn(
                'text-xs text-muted-foreground flex items-center'
              )}>
                {fee.name}
              </span>
              {fee.name === "Fee" ? (
                dynamicFeeLoading ? (
                  <motion.svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0 -translate-y-0.5"
                  >
                    {[
                      { x: 8, initialHeight: 7, fullHeight: 10 },
                      { x: 13, initialHeight: 12, fullHeight: 15 },
                      { x: 18, initialHeight: 10, fullHeight: 13 },
                    ].map((bar, i) => {
                      return (
                        <motion.line
                          key={i}
                          x1={bar.x}
                          y1={24}
                          x2={bar.x}
                          y2={24 - bar.initialHeight}
                          fill="currentColor"
                          stroke="currentColor"
                          strokeWidth={strokeWidth}
                          strokeLinecap="round"
                          animate={{
                            y2: [24 - bar.initialHeight, 24 - bar.fullHeight, 24 - bar.initialHeight],
                          }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.15,
                          }}
                        />
                      );
                    })}
                  </motion.svg>
                ) : (
                  <span className={'text-xs text-foreground'}>
                    {fee.value}
                  </span>
                )
              ) : (
                <span className={'text-xs text-muted-foreground'}>
                  {fee.value}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 h-10">
        {!isMounted ? null : isConnected ? (
          <Button
            className="w-full btn-primary"
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
          >
            {actionButtonText}
          </Button>
        ) : (
          <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md bg-accent text-accent-foreground px-3 text-sm font-medium transition-colors hover:bg-accent/90 shadow-md">
            <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
            <span className="relative z-0 pointer-events-none">{actionButtonText}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
} 