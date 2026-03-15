"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, SearchIcon, Loader2 } from 'lucide-react';
import { TokenImage } from '@/components/ui/token-image';
import { IconCheck, IconXmark } from 'nucleo-micro-bold-essential';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { batchQuotePrices } from '@/lib/swap/quote-prices';

import { readContracts, getBalance } from '@wagmi/core';
import { erc20Abi, formatUnits } from 'viem';
import { config } from '@/lib/wagmiConfig';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserTokens } from '@/hooks/useUserTokens';
import { type TokenInfo } from '@/lib/aggregators';
import { modeForChainId } from '@/lib/network-mode';

export interface TokenSelectorToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  balance?: string;
  value?: string;
  usdPrice?: number;
  networkMode?: string;
  chainId?: number;
  chainIcon?: string;
  chainLabel?: string;
}

interface TokenSelectorProps {
  selectedToken: TokenSelectorToken | null;
  availableTokens: TokenSelectorToken[];
  onTokenSelect: (token: TokenSelectorToken) => void;
  disabled?: boolean;
  excludeToken?: TokenSelectorToken;
  className?: string;
  swapContainerRect?: { top: number; left: number; width: number; height: number; }; // Deprecated: no longer used
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Chain metadata resolver for user tokens
const CHAIN_META_MAP: Record<number, { icon: string; label: string }> = {
  8453: { icon: '/chains/base.svg', label: 'Base' },
  42161: { icon: '/chains/arbitrum.svg', label: 'Arbitrum' },
};

function resolveChainMeta(chainId?: number): { icon: string; label: string } | undefined {
  return chainId ? CHAIN_META_MAP[chainId] : undefined;
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

// Token item component for the list
interface TokenItemProps {
  token: TokenSelectorToken;
  isSelected: boolean;
  balanceData?: TokenBalanceData;
  onClick: () => void;
}

function TokenItem({ token, isSelected, balanceData, onClick }: TokenItemProps) {
  const isLoadingBalance = balanceData?.isLoading || false;
  const displayBalance = balanceData?.balance || "~";
  const usdValue = balanceData?.usdValue || 0;

  return (
    <button
      className={cn(
        "w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/50 text-left transition-colors",
        { "bg-muted/30": isSelected }
      )}
      onClick={onClick}
    >
      <div className="relative w-8 h-8">
        <TokenImage
          src={token.icon || '/tokens/placeholder.svg'}
          alt={token.symbol}
          size={32}
        />
        {token.chainIcon && (
          <img
            src={token.chainIcon}
            alt={token.chainLabel || ''}
            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{token.symbol}</span>
              {isSelected && <IconCheck className="h-3 w-3 text-primary" />}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {token.chainLabel ? `${token.chainLabel} · ${formatTokenAddress(token.address)}` : formatTokenAddress(token.address)}
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
}

export function TokenSelector({
  selectedToken,
  availableTokens,
  onTokenSelect,
  disabled = false,
  excludeToken,
  className,
  swapContainerRect: _swapContainerRect, // Deprecated: no longer used for positioning
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
}: TokenSelectorProps) {
  const isMobile = useIsMobile();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = controlledOnOpenChange ?? setInternalIsOpen;
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
  // Track whether we've already loaded data for this "open session" — prevents re-fetching
  const hasLoadedForSessionRef = useRef(false);

  // Dynamic token search state
  const [searchResults, setSearchResults] = useState<TokenInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const { address: accountAddress, isConnected } = useAccount();

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

  const excludeAddress = excludeToken?.address?.toLowerCase();

  // --- Chain filter state ---
  // Detect available chains from the token list
  const availableChains = useMemo(() => {
    const chains = new Map<string, { networkMode: string; chainId: number; icon: string; label: string }>();
    for (const token of stableAvailableTokens) {
      const mode = token.networkMode || 'base';
      if (!chains.has(mode)) {
        chains.set(mode, {
          networkMode: mode,
          chainId: token.chainId || 8453,
          icon: token.chainIcon || '/chains/base.svg',
          label: token.chainLabel || 'Base',
        });
      }
    }
    return Array.from(chains.values());
  }, [stableAvailableTokens]);

  const [chainFilter, setChainFilter] = useState<string>(
    () => (selectedToken as any)?.networkMode || 'base'
  );

  // Chain filter's chainId for balance + price fetching
  const filterChainId = useMemo(() => {
    const chain = availableChains.find(c => c.networkMode === chainFilter);
    return chain?.chainId || 8453;
  }, [chainFilter, availableChains]);

  // Reset chain filter to current token's chain when selector opens
  useEffect(() => {
    if (isOpen) {
      setChainFilter((selectedToken as any)?.networkMode || 'base');
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user's tokens from Alchemy (includes balances, metadata, logos)
  const { tokens: userTokens, isLoading: isLoadingUserTokens } = useUserTokens();

  // REMOVED: CoinGecko token list / "All Tokens" — only show pool tokens + user's owned tokens

  // Merge pool tokens with user's tokens from Alchemy
  const allTokens = useMemo((): TokenSelectorToken[] => {
    // Use address+chainId composite key to properly differentiate cross-chain tokens
    const poolTokenKeys = new Set(stableAvailableTokens.map(t => `${t.address.toLowerCase()}:${t.chainId || ''}`));

    // Convert user tokens from Uniswap Portfolio API to TokenSelectorToken format
    const userTokensConverted: TokenSelectorToken[] = userTokens
      .filter(t => !poolTokenKeys.has(`${t.address.toLowerCase()}:${t.chainId || ''}`)) // Exclude duplicates
      .map(t => {
        const chainMeta = resolveChainMeta(t.chainId);
        return {
          address: t.address as `0x${string}`,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          icon: t.logo || '/tokens/placeholder.svg',
          balance: t.balance,
          // Pass through USD value from Uniswap API (formatted as string for consistency)
          value: t.balanceUSD != null ? `$${t.balanceUSD.toFixed(2)}` : undefined,
          usdPrice: t.balanceUSD != null && parseFloat(t.balance) > 0
            ? t.balanceUSD / parseFloat(t.balance)
            : undefined,
          networkMode: t.chainId ? modeForChainId(t.chainId) ?? undefined : undefined,
          chainId: t.chainId,
          chainIcon: chainMeta?.icon,
          chainLabel: chainMeta?.label,
        };
      });

    // Pool tokens first, then user's other tokens
    return [...stableAvailableTokens, ...userTokensConverted];
  }, [stableAvailableTokens, userTokens]);

  // Pool tokens (always shown in "Supported Tokens" section) - keyed by address+chainId
  const poolTokenKeySet = useMemo(
    () => new Set(stableAvailableTokens.map(t => `${t.address.toLowerCase()}:${t.chainId || ''}`)),
    [stableAvailableTokens]
  );

  // User-owned tokens that are NOT pool tokens (shown in "Your Tokens" section)
  const userOwnedTokens = useMemo(() => {
    return allTokens.filter(token => {
      // Exclude pool tokens — they're shown in the "Supported Tokens" section
      if (poolTokenKeySet.has(`${token.address.toLowerCase()}:${token.chainId || ''}`)) return false;
      // Must have a positive balance
      const balance = tokenBalances[token.address];
      if (!balance) return false;
      const numericBalance = parseFloat(balance.balance);
      return !isNaN(numericBalance) && numericBalance > 0;
    });
  }, [allTokens, tokenBalances, poolTokenKeySet]);

  // Handle search input change with debouncing
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);

    // Clear previous debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Abort previous search
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    // Clear results if no search term
    if (!value.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Debounce the API call
    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        setIsSearching(true);
        const response = await fetch(
          `/api/tokens/search?q=${encodeURIComponent(value)}&limit=30`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (data.success && data.tokens) {
          setSearchResults(data.tokens);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Token search failed:', err);
        }
      } finally {
        setIsSearching(false);
      }
    }, 200);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
    };
  }, []);

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
      // Reset session flag so next open triggers a fresh load
      hasLoadedForSessionRef.current = false;
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

  // Filter all tokens based on chain filter + search
  const filteredAvailableTokens = useMemo(() => {
    return allTokens
      .filter(token => excludeAddress ? token.address.toLowerCase() !== excludeAddress : true)
      .filter(token => {
        // Always apply chain filter (for both search and non-search)
        if (availableChains.length > 1) {
          const tokenChain = token.networkMode || 'base';
          if (tokenChain !== chainFilter) return false;
        }
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(search) ||
          token.name.toLowerCase().includes(search) ||
          token.address.toLowerCase().includes(search)
        );
      });
  }, [allTokens, excludeAddress, searchTerm, chainFilter, availableChains.length]);

  const filteredTokensKey = useMemo(
    () => filteredAvailableTokens.map((t) => t.address).join("|"),
    [filteredAvailableTokens]
  );
  const filteredTokensRef = useRef<{ key: string; value: TokenSelectorToken[] } | null>(null);
  useEffect(() => {
    filteredTokensRef.current = { key: filteredTokensKey, value: filteredAvailableTokens };
  }, [filteredTokensKey, filteredAvailableTokens]);

  // Fetch prices once when modal opens — don't re-fetch while open
  const hasFetchedPricesRef = useRef(false);
  useEffect(() => {
    if (!isOpen) { hasFetchedPricesRef.current = false; return; }
    if (hasFetchedPricesRef.current) return;
    if (filteredAvailableTokens.length > 0) {
      hasFetchedPricesRef.current = true;
      const symbols = filteredAvailableTokens.map(t => t.symbol);
      batchQuotePrices(symbols, filterChainId).then(setTokenPrices).catch(() => {});
    }
  }, [isOpen, filteredAvailableTokens, filterChainId]);

  // Store fetched raw balances so we can re-compute USD values when prices arrive
  const rawBalancesRef = useRef<Record<string, { balance: string; numericBalance: number }>>({});

  // Helper to parse USD value from token (either from API or formatted string)
  const getTokenUsdValue = useCallback((token: TokenSelectorToken): number => {
    if (token.usdPrice && token.balance) {
      const bal = parseFloat(token.balance);
      if (!isNaN(bal) && bal > 0) return bal * token.usdPrice;
    }
    if (token.value) {
      const parsed = parseFloat(token.value.replace(/[~$,]/g, '') || "0");
      if (!isNaN(parsed)) return parsed;
    }
    return 0;
  }, []);

  // Reset fetch flags when chain filter changes (while selector is open)
  const prevChainFilterRef = useRef(chainFilter);
  useEffect(() => {
    if (prevChainFilterRef.current !== chainFilter && isOpen) {
      prevChainFilterRef.current = chainFilter;
      hasLoadedForSessionRef.current = false;
      hasFetchedPricesRef.current = false;
    }
  }, [chainFilter, isOpen]);

  // Fetch balances once when modal opens — re-fetches when chain filter changes
  useEffect(() => {
    if (!isOpen) {
      hasLoadedForSessionRef.current = false;
      rawBalancesRef.current = {};
      return;
    }

    if (!isConnected || !accountAddress) {
      const resetBalances: Record<string, TokenBalanceData> = {};
      (filteredTokensRef.current?.value || filteredAvailableTokens).forEach(token => {
        resetBalances[token.address] = {
          balance: token.balance || "~",
          usdValue: getTokenUsdValue(token),
          isLoading: false
        };
      });
      setTokenBalances(resetBalances);
      return;
    }

    // Only fetch once per open session + chain filter combo
    if (hasLoadedForSessionRef.current) return;
    hasLoadedForSessionRef.current = true;

    const tokens = filteredTokensRef.current?.value || filteredAvailableTokens;

    // Show loading skeletons
    const initialBalances: Record<string, TokenBalanceData> = {};
    tokens.forEach(token => {
      initialBalances[token.address] = {
        balance: token.balance || "Loading...",
        usdValue: getTokenUsdValue(token),
        isLoading: true
      };
    });
    setTokenBalances(initialBalances);

    const fetchBalances = async () => {
      const newBalances: Record<string, TokenBalanceData> = {};
      const rawBals: Record<string, { balance: string; numericBalance: number }> = {};

      const nativeToken = tokens.find(t => t.address === "0x0000000000000000000000000000000000000000");
      const erc20Tokens = tokens.filter(t => t.address !== "0x0000000000000000000000000000000000000000");

      if (nativeToken) {
        try {
          const ethBalance = await getBalance(config, { address: accountAddress, chainId: filterChainId });
          const balance = formatUnits(ethBalance.value, 18);
          const numericBalance = parseFloat(balance);
          const displayBal = getFormattedDisplayBalance(numericBalance);
          rawBals[nativeToken.address] = { balance: displayBal, numericBalance };
          let usdValue = 0;
          if (nativeToken.usdPrice) usdValue = numericBalance * nativeToken.usdPrice;
          newBalances[nativeToken.address] = { balance: displayBal, usdValue, isLoading: false };
        } catch {
          rawBals[nativeToken.address] = { balance: "Error", numericBalance: 0 };
          newBalances[nativeToken.address] = { balance: "Error", usdValue: 0, isLoading: false };
        }
      }

      if (erc20Tokens.length > 0) {
        const contracts = erc20Tokens.map(token => ({
          address: token.address, abi: erc20Abi,
          functionName: 'balanceOf' as const, args: [accountAddress] as const,
          chainId: filterChainId,
        }));
        try {
          const results = await readContracts(config, { contracts });
          erc20Tokens.forEach((token, index) => {
            const result = results[index];
            if (result.status === 'success') {
              const balance = formatUnits(result.result as bigint, token.decimals);
              const numericBalance = parseFloat(balance);
              const displayBal = getFormattedDisplayBalance(numericBalance);
              let usdValue = 0;
              if (token.usdPrice) usdValue = numericBalance * token.usdPrice;
              rawBals[token.address] = { balance: displayBal, numericBalance };
              newBalances[token.address] = { balance: displayBal, usdValue, isLoading: false };
            } else {
              rawBals[token.address] = { balance: "0.000", numericBalance: 0 };
              newBalances[token.address] = { balance: "0.000", usdValue: 0, isLoading: false };
            }
          });
        } catch {
          erc20Tokens.forEach(token => {
            rawBals[token.address] = { balance: "0.000", numericBalance: 0 };
            newBalances[token.address] = { balance: "0.000", usdValue: 0, isLoading: false };
          });
        }
      }

      rawBalancesRef.current = rawBals;
      setTokenBalances(newBalances);
    };

    fetchBalances();
  }, [isOpen, isConnected, accountAddress, filteredTokensKey, chainFilter, filterChainId, getTokenUsdValue]);

  // When prices arrive, update USD values in-place (no skeleton flash)
  useEffect(() => {
    if (!isOpen || Object.keys(tokenPrices).length === 0) return;
    const raw = rawBalancesRef.current;
    if (Object.keys(raw).length === 0) return;

    setTokenBalances(prev => {
      const updated = { ...prev };
      const tokens = filteredTokensRef.current?.value || filteredAvailableTokens;
      for (const token of tokens) {
        const r = raw[token.address];
        const existing = prev[token.address];
        if (!r || !existing || existing.isLoading) continue;
        const price = tokenPrices[token.symbol] || token.usdPrice || 0;
        updated[token.address] = { ...existing, usdValue: r.numericBalance * price };
      }
      return updated;
    });
  }, [isOpen, tokenPrices, filteredAvailableTokens]);

  const handleTokenSelect = (token: TokenSelectorToken) => {
    // Enrich token with fresh balance from selector's own fetch
    const balanceData = tokenBalances[token.address];
    const enrichedToken = balanceData && !balanceData.isLoading
      ? { ...token, balance: balanceData.balance, value: `~$${balanceData.usdValue.toFixed(2)}` }
      : token;
    onTokenSelect(enrichedToken);
    setIsOpen(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  // Convert search result to TokenSelectorToken
  const convertSearchResultToToken = (info: TokenInfo): TokenSelectorToken => ({
    address: info.address as `0x${string}`,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    icon: info.logoURI || '/tokens/placeholder.svg',
  });

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  // Determine which tokens to show based on search state
  const displayTokens = useMemo(() => {
    // If actively searching with results, show search results
    if (searchTerm.trim() && searchResults.length > 0) {
      return searchResults.map(convertSearchResultToToken);
    }
    // If searching but no results yet, show filtered available tokens
    if (searchTerm.trim()) {
      return filteredAvailableTokens;
    }
    // Otherwise show all available tokens
    return filteredAvailableTokens;
  }, [searchTerm, searchResults, filteredAvailableTokens]);

  // Unified loading flag — true until user tokens + balances are all resolved
  const isInitialLoading = isLoadingUserTokens || Object.values(tokenBalances).some(b => b.isLoading);

  const tokenListContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        .token-list-scroll::-webkit-scrollbar { width: 6px; }
        .token-list-scroll::-webkit-scrollbar-track { background: transparent; }
        .token-list-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
        .token-list-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .token-list-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
      `}} />
      {/* Chain Picker + Search Input */}
      <div className="p-4 pb-3 flex flex-col gap-3">
        {/* Chain Toggle — above search, right-aligned */}
        {!searchTerm && availableChains.length > 1 && (
          <div className="flex gap-2 justify-end">
            {availableChains.map((chain) => (
              <button
                key={chain.networkMode}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all text-xs",
                  chainFilter === chain.networkMode
                    ? "bg-primary/10 border-primary/30"
                    : "border-sidebar-border/60 hover:bg-muted/50 hover:border-muted-foreground/30"
                )}
                onClick={() => setChainFilter(chain.networkMode)}
              >
                <img src={chain.icon} alt={chain.label} className="w-3.5 h-3.5 rounded-full" />
                <span className="font-medium">{chain.label}</span>
              </button>
            ))}
          </div>
        )}
        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or paste address"
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 pr-10 rounded-lg bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-muted-foreground/30 h-12 text-base"
            autoFocus={!isMobile}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground animate-spin" />
          )}
        </div>
      </div>

      {/* Scrollable token list — Your Tokens + All Tokens */}
      <div
        className={cn("overflow-y-auto flex-1 min-h-0 token-list-scroll", isMobile ? "overscroll-contain" : "")}
      >
        {/* Loading skeleton — shown until user tokens + balances are resolved */}
        {isInitialLoading && !searchTerm ? (
          <div className="py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full bg-muted/60 animate-pulse" />
                <div className="flex-1">
                  <div className="flex justify-between">
                    <div>
                      <div className="h-4 w-14 bg-muted/60 rounded animate-pulse mb-1.5" />
                      <div className="h-3 w-24 bg-muted/40 rounded animate-pulse" />
                    </div>
                    <div className="text-right">
                      <div className="h-4 w-16 bg-muted/60 rounded animate-pulse mb-1.5" />
                      <div className="h-3 w-12 bg-muted/40 rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayTokens.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {isSearching ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Searching...</span>
              </div>
            ) : searchTerm ? (
              `No tokens found matching "${searchTerm}"`
            ) : (
              "No tokens available"
            )}
          </div>
        ) : (
          <>
            {/* Supported Tokens — pool tokens, always shown */}
            {!searchTerm && (
              <div className="py-2">
                <div className="px-5 py-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Supported Tokens
                  </span>
                </div>
                {stableAvailableTokens
                  .filter(token => token.address.toLowerCase() !== excludeAddress)
                  .filter(token => availableChains.length <= 1 || (token.networkMode || 'base') === chainFilter)
                  .map((token) => (
                    <TokenItem
                      key={`pool-${token.address}`}
                      token={token}
                      isSelected={selectedToken ? token.address === selectedToken.address : false}
                      balanceData={tokenBalances[token.address]}
                      onClick={() => handleTokenSelect(token)}
                    />
                  ))}
              </div>
            )}

            {/* Your Tokens — user-owned tokens not in pool config */}
            {!searchTerm && isConnected && userOwnedTokens.length > 0 && (
              <>
                <div className="border-t border-sidebar-border/60" />
                <div className="py-2">
                  <div className="px-5 py-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Your Tokens
                    </span>
                  </div>
                  {userOwnedTokens
                    .filter(token => token.address.toLowerCase() !== excludeAddress)
                    .filter(token => availableChains.length <= 1 || (token.networkMode || 'base') === chainFilter)
                    .map((token) => (
                      <TokenItem
                        key={`yours-${token.address}:${token.chainId || ''}`}
                        token={token}
                        isSelected={selectedToken ? token.address === selectedToken.address : false}
                        balanceData={tokenBalances[token.address]}
                        onClick={() => handleTokenSelect(token)}
                      />
                    ))}
                </div>
              </>
            )}

            {/* Search results */}
            {searchTerm && (
              <div className="py-2">
                {displayTokens.map((token) => {
                  if (token.address.toLowerCase() === excludeAddress) return null;
                  return (
                    <TokenItem
                      key={token.address}
                      token={token}
                      isSelected={selectedToken ? token.address === selectedToken.address : false}
                      balanceData={tokenBalances[token.address]}
                      onClick={() => handleTokenSelect(token)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
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
        {selectedToken ? (
          <>
            <TokenImage
              src={selectedToken.icon || '/tokens/placeholder.svg'}
              alt={selectedToken.symbol}
              size={20}
            />
            <span className="text-sm font-medium">{selectedToken.symbol}</span>
          </>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">Select Token</span>
        )}
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
        /* Desktop: Portal Modal - Centered */
        isOpen && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="rounded-lg shadow-2xl border border-primary bg-popover w-full max-w-md h-[70vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
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
