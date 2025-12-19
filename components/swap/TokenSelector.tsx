"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ChevronDownIcon, CheckIcon, XIcon, SearchIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { getAllTokenPrices } from '@/lib/price-service';
import { getToken } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi, formatUnits } from 'viem';
import { config } from '@/lib/wagmiConfig';
import { useIsMobile } from '@/hooks/use-mobile';

export interface TokenSelectorToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  balance?: string;
  value?: string;
  usdPrice?: number;
}

interface TokenSelectorProps {
  selectedToken: TokenSelectorToken;
  availableTokens: TokenSelectorToken[];
  onTokenSelect: (token: TokenSelectorToken) => void;
  disabled?: boolean;
  excludeToken?: TokenSelectorToken; // Token to exclude from dropdown (e.g., the other token in swap)
  className?: string;
  swapContainerRect: { top: number; left: number; width: number; height: number; }; // New prop
}

// Helper function to format token address (6 + ... + 5)
const formatTokenAddress = (address: string): string => {
  if (address.length <= 11) return address;
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
};

// Helper function to format currency
const formatCurrency = (value: string): string => {
  const num = parseFloat(value || "0");
  if (num === 0) return "$0.00";
  if (num < 0.01) return "< $0.01";
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Helper function for formatting balance display
const getFormattedDisplayBalance = (numericBalance: number | undefined): string => {
  if (numericBalance === undefined || isNaN(numericBalance)) {
    numericBalance = 0;
  }
  if (numericBalance === 0) {
    return "0.000";
  } else if (numericBalance > 0 && numericBalance < 0.001) {
    return "< 0.001";
  } else {
    // Default to 4 decimals for display
    const displayDecimals = 4;
    return numericBalance.toFixed(displayDecimals);
  }
};

// Get token price mapping for quote API prices using pools.json data
const getTokenPriceMapping = (tokenSymbol: string): 'BTC' | 'USDC' | 'ETH' | 'DAI' => {
  // Get token config from pools.json
  const tokenConfig = getToken(tokenSymbol);
  if (!tokenConfig) return 'USDC'; // fallback
  
  // Map based on token names and symbols from pools.json
  switch (tokenSymbol) {
    case 'aBTC':
      return 'BTC';
    case 'aUSDC':
    case 'aUSDT':
      return 'USDC'; // Stablecoins
    case 'aDAI':
    case 'DAI':
      return 'DAI';
    case 'aETH':
    case 'ETH':
      return 'ETH';
    default:
      // Fallback logic based on token name
      if (tokenConfig.name.toLowerCase().includes('bitcoin') || tokenConfig.name.toLowerCase().includes('btc')) {
        return 'BTC';
      } else if (tokenConfig.name.toLowerCase().includes('ethereum') || tokenConfig.name.toLowerCase().includes('eth')) {
        return 'ETH';
      } else if (tokenConfig.name.toLowerCase().includes('dai')) {
        return 'DAI';
      } else {
        return 'USDC'; // Default to USDC for stablecoins and unknown tokens
      }
  }
};

interface TokenBalanceData {
  balance: string;
  usdValue: number;
  isLoading: boolean;
}

export function TokenSelector({
  selectedToken,
  availableTokens,
  onTokenSelect,
  disabled = false,
  excludeToken,
  className,
  swapContainerRect // New prop
}: TokenSelectorProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const sheetDragStartYRef = useRef<number | null>(null);
  const sheetTranslateYRef = useRef(0);
  const sheetRafRef = useRef<number | null>(null);
  const sheetInnerRef = useRef<HTMLDivElement | null>(null);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<{ BTC: number; USDC: number; ETH: number }>({
    BTC: 77000,
    USDC: 1,
    ETH: 3500
  });
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalanceData>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const { address: accountAddress, isConnected, chain } = useAccount();
  const currentChainId = chain?.id;
  const { chainId: targetChainId } = useNetwork();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsSheetDragging(false);
      sheetDragStartYRef.current = null;
      sheetTranslateYRef.current = 0;
      if (sheetRafRef.current != null) cancelAnimationFrame(sheetRafRef.current);
      sheetRafRef.current = null;
      if (sheetInnerRef.current) sheetInnerRef.current.style.transform = "translateY(0px)";
    }
  }, [isOpen]);

  const scheduleSheetTransform = () => {
    if (sheetRafRef.current != null) return;
    sheetRafRef.current = requestAnimationFrame(() => {
      sheetRafRef.current = null;
      const el = sheetInnerRef.current;
      if (!el) return;
      const y = sheetTranslateYRef.current;
      el.style.transform = y ? `translateY(${y}px)` : "translateY(0px)";
    });
  };

  const onSheetHandleTouchStart = (e: React.TouchEvent) => {
    sheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSheetDragging(true);
  };

  const onSheetHandleTouchMove = (e: React.TouchEvent) => {
    const startY = sheetDragStartYRef.current;
    if (startY == null) return;

    const currentY = e.touches[0]?.clientY ?? startY;
    const dy = currentY - startY;
    if (dy <= 0) return;

    sheetTranslateYRef.current = Math.min(dy, 220);
    scheduleSheetTransform();
  };

  const onSheetHandleTouchEnd = () => {
    const shouldClose = sheetTranslateYRef.current > 90;
    sheetDragStartYRef.current = null;
    setIsSheetDragging(false);
    sheetTranslateYRef.current = 0;
    scheduleSheetTransform();
    if (shouldClose) setIsOpen(false);
  };

  // Filter out the excluded token and apply search filter - memoized to prevent infinite loops
  const filteredTokens = useMemo(() => {
    return availableTokens
      .filter(token => excludeToken ? token.address !== excludeToken.address : true)
      .filter(token => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(search) ||
          token.name.toLowerCase().includes(search) ||
          token.address.toLowerCase().includes(search)
        );
      });
  }, [availableTokens, excludeToken, searchTerm]);

  // Position modal to overlay the SwapInputView - Now uses prop directly

  // Fetch token prices when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchPrices = async () => {
        try {
          // Use the existing price service with cache
          const prices = await getAllTokenPrices();
          setTokenPrices({
            BTC: prices.BTC.usd,
            USDC: prices.USDC.usd,
            ETH: prices.ETH?.usd || 3500 // fallback
          });
        } catch (error) {
          // Error fetching token prices
        }
      };

      fetchPrices();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isConnected || currentChainId !== targetChainId || !accountAddress) {
      const resetBalances: Record<string, TokenBalanceData> = {};
      filteredTokens.forEach(token => {
        resetBalances[token.address] = {
          balance: token.balance || "~",
          usdValue: token.value ? parseFloat(token.value.replace(/[~$,]/g, '') || "0") : 0,
          isLoading: false
        };
      });
      setTokenBalances(resetBalances);
      return;
    }

    const initialBalances: Record<string, TokenBalanceData> = {};
    filteredTokens.forEach(token => {
      initialBalances[token.address] = {
        balance: token.balance || "Loading...",
        usdValue: token.value ? parseFloat(token.value.replace(/[~$,]/g, '') || "0") : 0,
        isLoading: true
      };
    });
    setTokenBalances(initialBalances);

    const fetchBalances = async () => {
      const balancePromises = filteredTokens.map(async (token) => {
        try {
          let balance = '0';

          if (token.address === "0x0000000000000000000000000000000000000000") {
            const ethBalance = await getBalance(config, {
              address: accountAddress,
              chainId: targetChainId,
            });
            balance = formatUnits(ethBalance.value, 18);
          } else {
            const result = await readContract(config, {
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [accountAddress],
              chainId: targetChainId,
            });

            balance = formatUnits(result, token.decimals);
          }

          const priceType = getTokenPriceMapping(token.symbol);
          const usdPrice = tokenPrices[priceType] || 1;
          const numericBalance = parseFloat(balance);
          const usdValue = numericBalance * usdPrice;

          return {
            address: token.address,
            data: {
              balance: getFormattedDisplayBalance(numericBalance),
              usdValue,
              isLoading: false
            }
          };
        } catch (error) {
          return {
            address: token.address,
            data: {
              balance: "Error",
              usdValue: 0,
              isLoading: false
            }
          };
        }
      });

      const results = await Promise.all(balancePromises);
      const newBalances: Record<string, TokenBalanceData> = {};

      results.forEach(result => {
        newBalances[result.address] = result.data;
      });

      setTokenBalances(newBalances);
    };

    fetchBalances();
  }, [isOpen, isConnected, currentChainId, accountAddress, filteredTokens]);

  const handleTokenSelect = (token: TokenSelectorToken) => {
    onTokenSelect(token);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  // Shared token list content (used by both mobile sheet and desktop modal)
  const TokenListContent = () => (
    <>
      {/* Search Input */}
      <div className="p-4">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search token"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 rounded-lg bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-muted-foreground/30 h-12 text-base"
            autoFocus={!isMobile}
          />
        </div>
      </div>

      {/* Token List */}
      <div className={cn(
        "overflow-y-auto",
        isMobile ? "flex-1" : ""
      )} style={isMobile ? undefined : { maxHeight: `calc(100% - 125px)` }}>
        {filteredTokens.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No tokens found matching "{searchTerm}"
          </div>
        ) : (
          <div className="py-2">
            {filteredTokens.map((token) => {
              const isSelected = token.address === selectedToken.address;
              const balanceData = tokenBalances[token.address];
              const isLoadingBalance = balanceData?.isLoading || false;
              const displayBalance = balanceData?.balance || "~";
              const usdValue = balanceData?.usdValue || 0;

              return (
                <button
                  key={token.address}
                  className={cn(
                    "w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 text-left",
                    { "bg-muted/30": isSelected }
                  )}
                  onClick={() => handleTokenSelect(token)}
                >
                  <Image
                    src={token.icon}
                    alt={token.symbol}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{token.symbol}</span>
                          {isSelected && (
                            <CheckIcon className="h-3 w-3 text-primary" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {formatTokenAddress(token.address)}
                        </div>
                      </div>
                      <div className="text-right">
                        {isLoadingBalance ? (
                          <>
                            <div className="h-4 w-16 bg-muted/60 rounded loading-skeleton mb-1"></div>
                            <div className="h-3 w-12 bg-muted/60 rounded loading-skeleton"></div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-medium">
                              {displayBalance}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatCurrency(usdValue.toString())}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Selected Token Button */}
      <Button
        variant="ghost"
        className={cn(
          "flex items-center gap-1.5 bg-[var(--token-selector-background)] rounded-lg h-11 px-3 border border-sidebar-border/60 hover:bg-muted/30 transition-colors",
          {
            "cursor-not-allowed opacity-50": disabled,
            "bg-muted/30": isOpen
          }
        )}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <Image
          src={selectedToken.icon}
          alt={selectedToken.symbol}
          width={20}
          height={20}
          className="rounded-full"
        />
        <span className="text-sm font-medium">{selectedToken.symbol}</span>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            { "rotate-180": isOpen }
          )}
        />
      </Button>

      {/* Mobile: Bottom Sheet */}
      {isMobile ? (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl border-t border-primary p-0 flex flex-col bg-popover"
            style={{
              height: 'min(85dvh, 85vh)',
              maxHeight: 'min(85dvh, 85vh)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
            onPointerDownOutside={() => setIsOpen(false)}
          >
            <div
              ref={sheetInnerRef}
              className="flex flex-col flex-1"
              style={{ transition: isSheetDragging ? "none" : "transform 160ms ease-out" }}
            >
              {/* Drag handle */}
              <div
                className="flex justify-center pt-2 pb-1"
                onTouchStart={onSheetHandleTouchStart}
                onTouchMove={onSheetHandleTouchMove}
                onTouchEnd={onSheetHandleTouchEnd}
              >
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              </div>
              {/* Header */}
              <SheetHeader className="px-4 pt-4 pb-2 border-b border-sidebar-border/60 flex-shrink-0">
                <SheetTitle className="text-base font-medium text-left">
                  {excludeToken ? 'Swap From Token' : 'Swap To Token'}
                </SheetTitle>
              </SheetHeader>

              {/* Token List Content */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <TokenListContent />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        /* Desktop: Portal Modal */
        isOpen && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          >
            {/* Modal positioned to overlay SwapInputView */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed rounded-lg shadow-2xl border border-primary overflow-hidden bg-popover"
              onClick={(e) => e.stopPropagation()}
              style={{
                top: swapContainerRect.top,
                left: swapContainerRect.left,
                width: swapContainerRect.width,
                height: swapContainerRect.height,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-primary">
                <h2 className="text-sm font-medium">
                  {excludeToken ? 'Swap From Token' : 'Swap To Token'}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full"
                  onClick={() => setIsOpen(false)}
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              </div>

              {/* Token List Content */}
              <TokenListContent />
            </motion.div>
          </div>,
          document.body
        )
      )}
    </div>
  );
} 