"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Mock token interfaces
interface MockToken {
  symbol: string;
  name: string;
  balance: string;
  icon: string;
  usdPrice: number;
  displayDecimals: number; // Add displayDecimals for consistent formatting
}

// Mock token data
const mockTokens = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    balance: "100",
    icon: "/YUSD.png",
    usdPrice: 1,
    displayDecimals: 2
  } as MockToken,
  BTC: {
    symbol: "BTC",
    name: "Bitcoin",
    balance: "0",
    icon: "/BTCRL.png", 
    usdPrice: 77000,
    displayDecimals: 8
  } as MockToken
};

// Exact original OutlineArcIcon
function MockOutlineArcIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M 8,2 L 8,14"
        stroke="currentColor"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface MockSwapComponentProps {
  className?: string;
  zoom?: number;
}

export function MockSwapComponent({ className, zoom = 1.5 }: MockSwapComponentProps) {
  const fromToken = mockTokens.USDC;
  const toToken = mockTokens.BTC;
  const fromAmount = "0";
  const toAmount = "0";

  const formatCurrency = (value: string) => {
    const num = parseFloat(value || "0");
    return `$${num.toFixed(2)}`;
  };

  return (
    // Original clean design
    <div 
      className={cn("w-full bg-card rounded-xl border border-[#2f2f2f] p-6 shadow-lg backdrop-blur-sm", className)} 
      style={{ 
        width: '400px',
        zoom: zoom // CSS zoom re-renders at higher resolution
      }}
    >
      {/* Sell Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Sell</Label>
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
            >
              Balance: {fromToken.balance} {fromToken.symbol}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 rounded-full hover:bg-muted/40"
            >
              <MockOutlineArcIcon />
            </Button>
          </div>
        </div>
        <div className="rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 mr-2">
              <Image 
                src={fromToken.icon} 
                alt={fromToken.symbol} 
                width={20} 
                height={20} 
                className="rounded-full"
              />
              <span className="text-sm">{fromToken.symbol}</span>
            </div>
            <div className="flex-1">
              <Input
                value={fromAmount}
                readOnly
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto cursor-default pointer-events-none"
                placeholder="0"
              />
              <div className="text-right text-xs text-muted-foreground">
                {formatCurrency((parseFloat(fromAmount || "0") * fromToken.usdPrice).toString())}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Swap Button */}
      <div className="flex justify-center">
        <Button 
          variant="ghost" 
          size="icon" 
          className="rounded-full bg-muted/30 z-10 h-8 w-8" 
        >
          <ArrowDownIcon className="h-4 w-4" />
          <span className="sr-only">Swap tokens</span>
        </Button>
      </div>

      {/* Buy Section */}
      <div className="mb-6 mt-2">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Buy</Label>
          <span className="text-xs text-muted-foreground">
            Balance: {toToken.balance} {toToken.symbol}
          </span>
        </div>
        <div className="rounded-lg bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 min-w-[80px] mr-2">
              <Image 
                src={toToken.icon} 
                alt={toToken.symbol} 
                width={20} 
                height={20} 
                className="rounded-full" 
              />
              <span className="text-sm font-medium">{toToken.symbol}</span>
            </div>
            <div className="flex-1">
              <Input
                value={parseFloat(toAmount || "0") === 0 ? "0" : parseFloat(toAmount || "0").toFixed(toToken.displayDecimals)}
                readOnly
                className="text-right text-xl md:text-xl font-medium h-auto p-0 focus-visible:ring-0 focus-visible:ring-offset-0 border-0 bg-transparent text-muted-foreground cursor-default pointer-events-none"
                placeholder="0.00"
              />
              <div className="text-right text-xs text-muted-foreground">
                {formatCurrency((parseFloat(toAmount || "0") * toToken.usdPrice).toString())}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fee Information */}
      <div className="space-y-1 text-sm mt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Fee</span>
          <span className="text-xs text-foreground">0.10%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Fee Value (USD)</span>
          <span className="text-xs text-muted-foreground">$0.00</span>
        </div>
      </div>

      {/* Swap Button */}
      <div className="mt-4 h-10">
        <Button className="w-full bg-accent text-accent-foreground shadow-md transition-all duration-300 hover:bg-white hover:text-black active:scale-[0.98]">
          Swap
        </Button>
      </div>
    </div>
  );
} 