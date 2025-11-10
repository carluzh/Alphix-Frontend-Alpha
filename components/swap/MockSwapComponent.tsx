"use client";

import React, { useState } from 'react';
import { SwapInputView } from './SwapInputView';
import { Token, FeeDetail } from './swap-interface';

// Mock token data that matches the Token interface
const mockTokens: Record<string, Token> = {
  aUSDC: {
    address: "0x24429b8f2C8ebA374Dd75C0a72BCf4dF4C545BeD" as `0x${string}`,
    symbol: "USDC",
    name: "USDC",
    decimals: 6,
    balance: "100",
    value: "$100.00",
    icon: "/tokens/aUSDC.png",
    usdPrice: 1
  },
  aBTC: {
    address: "0x9d5F910c91E69ADDDB06919825305eFEa5c9c604" as `0x${string}`,
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 8,
    balance: "0",
    value: "$0.00",
    icon: "/tokens/aBTC.png",
    usdPrice: 77000
  }
};

interface MockSwapComponentProps {
  className?: string;
  zoom?: number;
}

export function MockSwapComponent({ className, zoom = 1.5 }: MockSwapComponentProps) {
  const [fromAmount] = useState("0");
  const [toAmount] = useState("0.00");
  const [isSellInputFocused] = useState(false);
  const [slippage] = useState(0.5);
  const [hoveredArcPercentage, setHoveredArcPercentage] = useState<number | null>(null);

  const displayFromToken = mockTokens.aUSDC;
  const displayToToken = mockTokens.aBTC;
  const availableTokens = Object.values(mockTokens);

  // Mock handlers that do nothing on click but allow hover effects
  const handleFromAmountChange = () => {};
  const onToAmountChange = () => {};
  const handleSwapTokens = () => {};
  const handleUsePercentage = () => {};
  const onFromTokenSelect = () => {};
  const onToTokenSelect = () => {};
  const handleCyclePercentage = () => {};
  const handleMouseEnterArc = () => {
    setHoveredArcPercentage(25);
  };
  const handleMouseLeaveArc = () => {
    setHoveredArcPercentage(null);
  };
  const handleSwap = () => {
    window.location.href = '/swap';
  };
  const onSlippageChange = () => {};
  const onAutoSlippageToggle = () => {};
  const onCustomSlippageToggle = () => {};

  const formatCurrency = (value: string) => {
    const num = parseFloat(value || "0");
    return `$${num.toFixed(2)}`;
  };

  const calculatedValues: {
    fees: FeeDetail[];
    minimumReceived: string;
  } = {
    fees: [],
    minimumReceived: "0.00"
  };

  const swapContainerRect = { top: 0, left: 0, width: 400, height: 600 };

  // Mock route info
  const routeInfo = {
    path: ["USDC", "BTC"],
    hops: 1,
    isDirectRoute: true,
    pools: ["USDC-BTC"]
  };

  // Mock route fees
  const routeFees = [
    { poolName: "USDC-BTC", fee: 1000 }
  ];

  return (
    <div 
      className={`bg-[#131313] rounded-xl border border-[#2f2f2f] p-6 shadow-lg backdrop-blur-sm [&_button[class*="w-full"][disabled]:hover]:brightness-110 [&_button[class*="w-full"][disabled]:hover]:border-white/30 [&_input]:!pointer-events-none [&_[role="button"]]:!pointer-events-none [&_[data-radix-collection-item]]:!pointer-events-none [&_[data-radix-portal]]:!hidden [&_[data-state="open"]]:!hidden [&_.fixed]:!hidden [&_[class*="fixed"]]:!hidden [&_[class*="z-50"]]:!hidden [&_[class*="z-[50]"]]:!hidden [&_[class*="AnimatePresence"]]:!hidden [&_[class*="motion"]]:!hidden [&_[class*="modal"]]:!hidden [&_[class*="Modal"]]:!hidden [&_button[class*="bg-muted/30"]]:!cursor-pointer [&_svg[class*="rotate-180"]]:!rotate-0 [&_svg[class*="transition-transform"]]:!rotate-0 [&_button[disabled]]:!cursor-pointer [&_button[class*="w-full"]]:!pointer-events-auto [&_button[class*="w-full"]]:!border [&_button[class*="w-full"]]:!border-sidebar-border [&_button[class*="w-full"]]:!bg-[var(--sidebar-connect-button-bg)] [&_button[class*="w-full"]]:!text-white/75 [&_button[class*="w-full"]]:![background-image:url(/pattern_wide.svg)] [&_button[class*="w-full"]]:![background-size:cover] [&_button[class*="w-full"]]:![background-position:center] [&_button[class*="w-full"]:hover]:!border-sidebar-primary [&_button[class*="w-full"]:hover]:!bg-[#3d271b]/90 [&_button[class*="w-full"]:hover]:!text-sidebar-primary [&_button[class*="w-full"]:hover]:![background-image:none] [&_button[class*="w-full"]:hover]:![background-size:auto] [&_button[class*="w-full"]:hover]:![background-position:auto] ${className || ''}`}
      style={{ 
        zoom: zoom,
        maxWidth: '400px',
        width: '100%'
      }}
      onClick={(e) => {
        // Only prevent the dropdown from opening, allow other clicks to bubble up
        const target = e.target as HTMLElement;
        const button = target.closest('button[class*="bg-muted/30"]');
        if (button) {
          // Check if this is specifically a TokenSelector button with dropdown functionality
          const chevronIcon = button.querySelector('svg[class*="h-4 w-4"][class*="text-muted-foreground"]');
          if (chevronIcon) {
            // Only prevent the dropdown opening, don't stop propagation for navigation
            e.preventDefault();
            // Don't call stopPropagation() to allow parent navigation to work
          }
        }

        // Always navigate to /swap on any click inside the mock (demo behavior)
        window.location.href = '/swap';
      }}
    >
      <SwapInputView
        displayFromToken={displayFromToken}
        displayToToken={displayToToken}
        fromAmount={fromAmount}
        toAmount={toAmount}
        handleFromAmountChange={handleFromAmountChange}
        onToAmountChange={onToAmountChange}
        activelyEditedSide="from"
        handleSwapTokens={handleSwapTokens}
        handleUsePercentage={handleUsePercentage}
        availableTokens={availableTokens}
        onFromTokenSelect={onFromTokenSelect}
        onToTokenSelect={onToTokenSelect}
        formatCurrency={formatCurrency}
        isConnected={true}
        isAttemptingSwitch={false}
        isLoadingCurrentFromTokenBalance={false}
        isLoadingCurrentToTokenBalance={false}
        calculatedValues={calculatedValues}
        dynamicFeeLoading={false}
        quoteLoading={false}
        quoteError={null}
         actionButtonText="Swap"
         actionButtonDisabled={false}
         handleSwap={handleSwap}
        isMounted={true}
        currentChainId={1}
        TARGET_CHAIN_ID={1}
        routeInfo={routeInfo}
        routeFees={routeFees}
        routeFeesLoading={false}
        showRoute={false}
        selectedPoolIndexForChart={0}
        onSelectPoolForChart={() => {}}
        swapContainerRect={swapContainerRect}
        slippage={slippage}
        isAutoSlippage={true}
        autoSlippageValue={0.5}
        onSlippageChange={onSlippageChange}
        onAutoSlippageToggle={onAutoSlippageToggle}
        onCustomSlippageToggle={onCustomSlippageToggle}
      />
    </div>
  );
} 