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
import { TokenSelector, TokenSelectorToken } from './TokenSelector';
import { getToken } from '@/lib/pools-config';

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
            <TokenSelector
              selectedToken={displayFromToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onFromTokenSelect}
              excludeToken={displayToToken as TokenSelectorToken}
              disabled={!isConnected || isAttemptingSwitch}
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
        <div className="rounded-lg bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <TokenSelector
              selectedToken={displayToToken as TokenSelectorToken}
              availableTokens={availableTokens as TokenSelectorToken[]}
              onTokenSelect={onToTokenSelect}
              excludeToken={displayFromToken as TokenSelectorToken}
              disabled={!isConnected || isAttemptingSwitch}
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

      {/* Route Information - Shows if we have route info and connected */}
      {routeInfo && isConnected && currentChainId === TARGET_CHAIN_ID && !quoteError && (
        <div className="mt-3 mb-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Route:</span>
            <div className="flex items-center gap-1.5">
              {routeInfo.path.map((tokenSymbol, index) => {
                const tokenConfig = getToken(tokenSymbol);
                const tokenIcon = tokenConfig?.icon || "/placeholder-logo.svg";
                
                // Get the fee for this token (if it's not the last token in the path)
                const showFee = index < routeInfo.path.length - 1;
                const fee = showFee && routeFees && routeFees[index] 
                  ? `${(routeFees[index].fee / 10000).toFixed(2)}%` 
                  : null;
                
                const isSelectedForChart = selectedPoolIndexForChart === index;
                
                return (
                  <React.Fragment key={`${tokenSymbol}-${index}`}>
                    <div className="flex items-center gap-1">
                      <Image 
                        src={tokenIcon} 
                        alt={tokenSymbol} 
                        width={16} 
                        height={16} 
                        className="rounded-full"
                      />
                      {fee && (
                        <button 
                          onClick={() => onSelectPoolForChart?.(index)}
                          className={`text-xs font-medium transition-colors hover:text-foreground cursor-pointer ${
                            isSelectedForChart 
                              ? 'text-foreground/80 underline decoration-dotted decoration-1 underline-offset-2' 
                              : 'text-foreground/80'
                          }`}
                        >
                          {fee}
                        </button>
                      )}
                    </div>
                    {index < routeInfo.path.length - 1 && (
                      <div className="h-1 w-1 rounded-full bg-muted-foreground/60"></div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
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