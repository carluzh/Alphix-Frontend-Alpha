"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ChevronDownIcon, SearchIcon } from 'lucide-react';
import { IconCheck, IconXmark } from 'nucleo-micro-bold-essential';
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
import { batchQuotePrices } from '@/lib/quote-prices';
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
  excludeToken?: TokenSelectorToken;
  className?: string;
  swapContainerRect: { top: number; left: number; width: number; height: number; };
}

const formatTokenAddress = (address: string): string => {
  if (address.length <= 11) return address;
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
};

const formatCurrency = (value: string): string => {
  const num = parseFloat(value || "0");
  if (num === 0) return "$0.00";
  if (num < 0.01) return "< $0.01";
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getFormattedDisplayBalance = (numericBalance: number | undefined): string => {
  if (numericBalance === undefined || isNaN(numericBalance)) {
    numericBalance = 0;
  }
  if (numericBalance === 0) {
    return "0.000";
  } else if (numericBalance > 0 && numericBalance < 0.001) {
    return "< 0.001";
  } else {
    const displayDecimals = 4;
    return numericBalance.toFixed(displayDecimals);
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
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const sheetInitialFocusRef = useRef<HTMLDivElement | null>(null);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalanceData>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const { address: accountAddress, isConnected, chain } = useAccount();
  const currentChainId = chain?.id;
  const { chainId: targetChainId } = useNetwork();

  const availableTokensKey = useMemo(
    () => availableTokens.map((t) => t.address).join("|"),
    [availableTokens]
  );
  const stableAvailableTokensRef = useRef<{ key: string; value: TokenSelectorToken[] } | null>(null);
  const stableAvailableTokens = useMemo(() => {
    const prev = stableAvailableTokensRef.current;
    if (prev?.key === availableTokensKey) return prev.value;
    stableAvailableTokensRef.current = { key: availableTokensKey, value: availableTokens };
    return availableTokens;
  }, [availableTokensKey, availableTokens]);

  const excludeAddress = excludeToken?.address;

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
      if (sheetContentRef.current) sheetContentRef.current.style.transform = "translate3d(0, 0, 0)";
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    const raf = requestAnimationFrame(() => {
      sheetInitialFocusRef.current?.focus?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, isMobile]);

  const scheduleSheetTransform = () => {
    if (sheetRafRef.current != null) return;
    sheetRafRef.current = requestAnimationFrame(() => {
      sheetRafRef.current = null;
      const el = sheetContentRef.current;
      if (!el) return;
      const y = sheetTranslateYRef.current;
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "translate3d(0, 0, 0)";
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

  const filteredTokens = useMemo(() => {
    return stableAvailableTokens
      .filter(token => excludeAddress ? token.address !== excludeAddress : true)
      .filter(token => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(search) ||
          token.name.toLowerCase().includes(search) ||
          token.address.toLowerCase().includes(search)
        );
      });
  }, [stableAvailableTokens, excludeAddress, searchTerm]);

  const filteredTokensKey = useMemo(
    () => filteredTokens.map((t) => t.address).join("|"),
    [filteredTokens]
  );
  const filteredTokensRef = useRef<{ key: string; value: TokenSelectorToken[] } | null>(null);
  useEffect(() => {
    filteredTokensRef.current = { key: filteredTokensKey, value: filteredTokens };
  }, [filteredTokensKey, filteredTokens]);

  const tokenPricesKey = useMemo(
    () => Object.entries(tokenPrices).map(([k, v]) => `${k}:${v}`).join('|'),
    [tokenPrices]
  );

  useEffect(() => {
    if (isOpen && filteredTokens.length > 0) {
      const symbols = filteredTokens.map(t => t.symbol);
      batchQuotePrices(symbols, targetChainId).then(setTokenPrices).catch(() => {});
    }
  }, [isOpen, filteredTokens, targetChainId]);

  useEffect(() => {
    if (!isOpen || !isConnected || currentChainId !== targetChainId || !accountAddress) {
      const resetBalances: Record<string, TokenBalanceData> = {};
      (filteredTokensRef.current?.value || filteredTokens).forEach(token => {
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
    const tokens = filteredTokensRef.current?.value || filteredTokens;
    tokens.forEach(token => {
      initialBalances[token.address] = {
        balance: token.balance || "Loading...",
        usdValue: token.value ? parseFloat(token.value.replace(/[~$,]/g, '') || "0") : 0,
        isLoading: true
      };
    });
    setTokenBalances(initialBalances);

    const fetchBalances = async () => {
      const balancePromises = tokens.map(async (token) => {
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

          const usdPrice = tokenPrices[token.symbol] || 0;
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
  }, [isOpen, isConnected, currentChainId, targetChainId, accountAddress, filteredTokensKey, tokenPricesKey]);

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

  const tokenListContent = (
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
      <div
        className={cn("overflow-y-auto", isMobile ? "flex-1 overscroll-contain" : "")}
        style={isMobile ? undefined : { maxHeight: `calc(100% - 125px)` }}
      >
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
                          {isSelected && <IconCheck className="h-3 w-3 text-primary" />}
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
                            <div className="text-sm font-medium">{displayBalance}</div>
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
        onClick={() => {
          if (isMobile) {
            const el = document.activeElement as HTMLElement | null;
            el?.blur?.();
          }
          setIsOpen(!isOpen);
        }}
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
            ref={sheetContentRef}
            tabIndex={-1}
            className="rounded-t-2xl border-t border-primary p-0 flex flex-col bg-popover"
            style={{
              height: 'min(85dvh, 85vh)',
              maxHeight: 'min(85dvh, 85vh)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              transition: isSheetDragging ? "none" : "transform 160ms ease-out",
            }}
            onPointerDownOutside={() => setIsOpen(false)}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              sheetInitialFocusRef.current?.focus?.();
            }}
          >
            <div className="flex flex-col flex-1">
              <div ref={sheetInitialFocusRef} tabIndex={-1} aria-hidden className="h-0 w-0 overflow-hidden" />
              <div
                className="flex items-center justify-center h-10 -mb-1 touch-none"
                onTouchStart={onSheetHandleTouchStart}
                onTouchMove={onSheetHandleTouchMove}
                onTouchEnd={onSheetHandleTouchEnd}
              >
                <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
              </div>
              {/* Header */}
              <SheetHeader className="px-4 pt-4 pb-2 border-b border-sidebar-border/60 flex-shrink-0">
                <SheetTitle className="text-base font-medium text-left">
                  {excludeToken ? 'Swap From Token' : 'Swap To Token'}
                </SheetTitle>
              </SheetHeader>

              {/* Token List Content */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {tokenListContent}
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
                  <IconXmark className="h-3 w-3" />
                </Button>
              </div>

              {/* Token List Content */}
              {tokenListContent}
            </motion.div>
          </div>,
          document.body
        )
      )}
    </div>
  );
} 