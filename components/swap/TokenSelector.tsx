"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { ChevronDownIcon, CheckIcon, XIcon, SearchIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { getAllTokenPrices } from '@/lib/price-service';
import { getToken, CHAIN_ID } from '@/lib/pools-config';
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi, formatUnits } from 'viem';
import { config } from '@/lib/wagmiConfig';

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

// Helper function for formatting balance display using displayDecimals from pools.json
const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbol: string): string => {
  if (numericBalance === undefined || isNaN(numericBalance)) {
    numericBalance = 0;
  }
  if (numericBalance === 0) {
    return "0.000";
  } else if (numericBalance > 0 && numericBalance < 0.001) {
    return "< 0.001";
  } else {
    // Use displayDecimals from pools.json config
    const tokenConfig = getToken(tokenSymbol);
    const displayDecimals = tokenConfig?.displayDecimals || 4;
    return numericBalance.toFixed(displayDecimals);
  }
};

// Get token price mapping for CoinGecko prices using pools.json data
const getTokenPriceMapping = (tokenSymbol: string): 'BTC' | 'USDC' | 'ETH' => {
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
    case 'aETH':
    case 'ETH':
      return 'ETH';
    default:
      // Fallback logic based on token name
      if (tokenConfig.name.toLowerCase().includes('bitcoin') || tokenConfig.name.toLowerCase().includes('btc')) {
        return 'BTC';
      } else if (tokenConfig.name.toLowerCase().includes('ethereum') || tokenConfig.name.toLowerCase().includes('eth')) {
        return 'ETH';
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
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tokenPrices, setTokenPrices] = useState<{ BTC: number; USDC: number; ETH: number }>({
    BTC: 77000,
    USDC: 1,
    ETH: 3500
  });
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalanceData>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const { address: accountAddress, isConnected, chain } = useAccount();
  const currentChainId = chain?.id;

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
            BTC: prices.BTC,
            USDC: prices.USDC,
            ETH: prices.ETH || 3500 // fallback
          });
        } catch (error) {
          // Error fetching token prices
        }
      };

      fetchPrices();
    }
  }, [isOpen]);

  // Fetch token balances when modal opens - using wagmi core to avoid hook rules violations
  useEffect(() => {
    if (!isOpen || !isConnected || currentChainId !== CHAIN_ID || !accountAddress) {
      // Reset balances when not ready
      const resetBalances: Record<string, TokenBalanceData> = {};
      filteredTokens.forEach(token => {
        resetBalances[token.address] = {
          balance: "~",
          usdValue: 0,
          isLoading: false
        };
      });
      setTokenBalances(resetBalances);
      return;
    }

    // Set loading state
    const loadingBalances: Record<string, TokenBalanceData> = {};
    filteredTokens.forEach(token => {
      loadingBalances[token.address] = {
        balance: "Loading...",
        usdValue: 0,
        isLoading: true
      };
    });
    setTokenBalances(loadingBalances);

    // Fetch balances for all tokens in parallel
    const fetchBalances = async () => {
      const balancePromises = filteredTokens.map(async (token) => {
        try {
          let balance = '0';
          
          if (token.address === "0x0000000000000000000000000000000000000000") {
            // Native ETH balance
            const ethBalance = await getBalance(config, {
              address: accountAddress,
              chainId: CHAIN_ID,
            });
            balance = formatUnits(ethBalance.value, 18); // ETH has 18 decimals
          } else {
            // ERC20 token
            const result = await readContract(config, {
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [accountAddress],
              chainId: CHAIN_ID,
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
              balance: getFormattedDisplayBalance(numericBalance, token.symbol),
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
  }, [isOpen, isConnected, currentChainId, accountAddress, filteredTokens, tokenPrices]);

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
        onClick={() => setIsOpen(!isOpen)} // Directly toggle isOpen
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

      {/* Token Selection Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50"
            onClick={() => setIsOpen(false)} // Directly close isOpen
          >
            {/* Modal positioned to overlay SwapInputView */}
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="fixed rounded-lg shadow-2xl border border-border overflow-hidden bg-popover" // Changed to fixed and bg-popover
              onClick={(e) => e.stopPropagation()}
              style={{
                top: swapContainerRect.top,
                left: swapContainerRect.left,
                width: swapContainerRect.width,
                height: swapContainerRect.height,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-sm font-medium">
                  {excludeToken ? 'Swap From Token' : 'Swap To Token'} {/* Reverted header text logic */}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full"
                  onClick={() => setIsOpen(false)} // Directly close isOpen
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              </div>

              {/* Search Input */}
              <div className="p-4">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="WETH, USDC, 0x..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 rounded-lg bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-muted-foreground/30 h-10 text-sm"
                    autoFocus
                  />
                </div>
              </div>

              {/* Token List - Simple Layout */}
              <div className="overflow-y-auto" style={{ maxHeight: `calc(100% - 105px)` }}> {/* Dynamic max height: 100% of parent height - (header 33px + search 72px) */}
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
                            "w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left",
                            {
                              "bg-muted/30": isSelected
                            }
                          )}
                          onClick={() => handleTokenSelect(token)}
                        >
                          <Image 
                            src={token.icon} 
                            alt={token.symbol} 
                            width={28} 
                            height={28} 
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
} 