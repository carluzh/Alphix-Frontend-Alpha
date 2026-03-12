"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ArrowLeftIcon, SearchIcon, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { TokenImage } from "@/components/ui/token-image";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAccount } from "wagmi";
import { batchQuotePrices } from "@/lib/swap/quote-prices";
import { readContracts, getBalance } from "@wagmi/core";
import { erc20Abi, formatUnits } from "viem";
import { config } from "@/lib/wagmiConfig";
import { useUserTokens } from "@/hooks/useUserTokens";
import { type TokenInfo } from "@/lib/aggregators";
import { modeForChainId } from "@/lib/network-mode";
import type { TokenSelectorToken } from "./TokenSelector";

// ─── Nucleo check-2 icon (inline SVG) ────────────────────────────────────────
function NucleoCheck({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={className} fill="none">
      <polyline points="6.5 10.5 8.75 13 13.5 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

// ─── Chain Metadata ─────────────────────────────────────────────────────────
const CHAIN_META_MAP: Record<number, { icon: string; label: string }> = {
  8453: { icon: "/chains/base.svg", label: "Base" },
  42161: { icon: "/chains/arbitrum.svg", label: "Arbitrum" },
};

function resolveChainMeta(chainId?: number) {
  return chainId ? CHAIN_META_MAP[chainId] : undefined;
}

// ─── Formatting ─────────────────────────────────────────────────────────────
const formatCurrency = (value: string): string => {
  const num = parseFloat(value || "0");
  if (num === 0) return "$0.00";
  if (num < 0.01) return "< $0.01";
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getFormattedDisplayBalance = (numericBalance: number | undefined): string => {
  if (numericBalance === undefined || isNaN(numericBalance)) numericBalance = 0;
  if (numericBalance === 0) return "0";
  if (numericBalance > 0 && numericBalance < 0.001) return "< 0.001";
  return numericBalance.toFixed(4);
};

interface TokenBalanceData {
  balance: string;
  usdValue: number;
  isLoading: boolean;
}

// ─── Props ──────────────────────────────────────────────────────────────────
export interface SwapTokenSelectorPanelProps {
  side: "from" | "to";
  selectedToken: TokenSelectorToken | null;
  availableTokens: TokenSelectorToken[];
  excludeToken?: TokenSelectorToken;
  onTokenSelect: (token: TokenSelectorToken) => void;
  onClose: () => void;
}

// ─── Inline Token Item ──────────────────────────────────────────────────────
function InlineTokenItem({
  token,
  isSelected,
  balanceData,
  onClick,
}: {
  token: TokenSelectorToken;
  isSelected: boolean;
  balanceData?: TokenBalanceData;
  onClick: () => void;
}) {
  const isLoadingBalance = balanceData?.isLoading || false;
  const displayBalance = balanceData?.balance || "0.00";
  const usdValue = balanceData?.usdValue || 0;

  return (
    <button
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 rounded-lg mx-1",
        "hover:bg-white/[0.04]",
        isSelected && "bg-white/[0.03]"
      )}
      style={{ width: "calc(100% - 8px)" }}
      onClick={onClick}
    >
      {/* Token image with chain badge */}
      <div className="relative shrink-0">
        <TokenImage
          src={token.icon || "/tokens/placeholder.svg"}
          alt={token.symbol}
          size={36}
        />
        {token.chainIcon && (
          <img
            src={token.chainIcon}
            alt=""
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-sm ring-2 ring-[var(--surface-bg,var(--card))]"
          />
        )}
      </div>

      {/* Name (title) + Ticker & Address (subtitle) */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium leading-tight truncate text-white/90">
            {token.name}
          </span>
          {isSelected && (
            <NucleoCheck className="h-3.5 w-3.5 text-primary shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[12px] text-white/50 leading-tight">
            {token.symbol}
          </span>
          <span className="text-[12px] text-muted-foreground/35 leading-tight">
            {token.address === "0x0000000000000000000000000000000000000000"
              ? "Native"
              : `${token.address.slice(0, 6)}...${token.address.slice(-4)}`}
          </span>
        </div>
      </div>

      {/* Balance + USD */}
      <div className="text-right shrink-0">
        {isLoadingBalance ? (
          <>
            <div className="h-4 w-14 bg-white/[0.06] rounded-md animate-pulse mb-1" />
            <div className="h-3.5 w-12 bg-white/[0.04] rounded-md animate-pulse" />
          </>
        ) : (
          <>
            <div className="text-[13px] font-medium tabular-nums">{displayBalance}</div>
            <div className="text-[12px] text-muted-foreground/60 tabular-nums">
              {formatCurrency(usdValue.toString())}
            </div>
          </>
        )}
      </div>
    </button>
  );
}

// ─── Chain Toggle Button ─────────────────────────────────────────────────────
function ChainToggleButton({
  availableChains,
  chainFilter,
  onToggleChain,
}: {
  availableChains: { networkMode: string; chainId: number; icon: string; label: string }[];
  chainFilter: string;
  onToggleChain: (mode: string) => void;
}) {
  const activeChain = availableChains.find((c) => c.networkMode === chainFilter) || availableChains[0];

  const handleToggle = () => {
    const currentIndex = availableChains.findIndex((c) => c.networkMode === chainFilter);
    const nextIndex = (currentIndex + 1) % availableChains.length;
    onToggleChain(availableChains[nextIndex].networkMode);
  };

  return (
    <button
      onClick={handleToggle}
      className="ml-auto flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors"
      title={`Switch to ${availableChains.find((c) => c.networkMode !== chainFilter)?.label || "other chain"}`}
    >
      <img
        src={activeChain.icon}
        alt={activeChain.label}
        className="w-5 h-5 rounded-sm"
      />
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function SwapTokenSelectorPanel({
  side,
  selectedToken,
  availableTokens,
  excludeToken,
  onTokenSelect,
  onClose,
}: SwapTokenSelectorPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalanceData>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedRef = useRef(false);
  const rawBalancesRef = useRef<Record<string, { balance: string; numericBalance: number }>>({});

  // Dynamic token search
  const [searchResults, setSearchResults] = useState<TokenInfo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const { address: accountAddress, isConnected } = useAccount();
  const { tokens: userTokens, isLoading: isLoadingUserTokens } = useUserTokens();

  const excludeAddress = excludeToken?.address?.toLowerCase();

  // ── Chain filter ────────────────────────────────────────────────────────
  const availableChains = useMemo(() => {
    const chains = new Map<string, { networkMode: string; chainId: number; icon: string; label: string }>();
    for (const token of availableTokens) {
      const mode = token.networkMode || "base";
      if (!chains.has(mode)) {
        chains.set(mode, {
          networkMode: mode,
          chainId: token.chainId || 8453,
          icon: token.chainIcon || "/chains/base.svg",
          label: token.chainLabel || "Base",
        });
      }
    }
    return Array.from(chains.values());
  }, [availableTokens]);

  const [chainFilter, setChainFilter] = useState<string>(
    () => (selectedToken as any)?.networkMode || "base"
  );

  const filterChainId = useMemo(() => {
    const chain = availableChains.find((c) => c.networkMode === chainFilter);
    return chain?.chainId || 8453;
  }, [chainFilter, availableChains]);

  // ── Pool token set ──────────────────────────────────────────────────────
  const poolTokenKeySet = useMemo(
    () => new Set(availableTokens.map((t) => `${t.address.toLowerCase()}:${t.chainId || ""}`)),
    [availableTokens]
  );

  // ── Merge pool + user tokens ────────────────────────────────────────────
  const allTokens = useMemo((): TokenSelectorToken[] => {
    const poolKeys = new Set(availableTokens.map((t) => `${t.address.toLowerCase()}:${t.chainId || ""}`));
    const converted: TokenSelectorToken[] = userTokens
      .filter((t) => !poolKeys.has(`${t.address.toLowerCase()}:${t.chainId || ""}`))
      .map((t) => {
        const chainMeta = resolveChainMeta(t.chainId);
        return {
          address: t.address as `0x${string}`,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          icon: t.logo || "/tokens/placeholder.svg",
          balance: t.balance,
          value: t.balanceUSD != null ? `$${t.balanceUSD.toFixed(2)}` : undefined,
          usdPrice:
            t.balanceUSD != null && parseFloat(t.balance) > 0
              ? t.balanceUSD / parseFloat(t.balance)
              : undefined,
          networkMode: t.chainId ? (modeForChainId(t.chainId) ?? undefined) : undefined,
          chainId: t.chainId,
          chainIcon: chainMeta?.icon,
          chainLabel: chainMeta?.label,
        };
      });
    return [...availableTokens, ...converted];
  }, [availableTokens, userTokens]);

  // ── Filter tokens ───────────────────────────────────────────────────────
  const filteredTokens = useMemo(() => {
    return allTokens
      .filter((t) => (excludeAddress ? t.address.toLowerCase() !== excludeAddress : true))
      .filter((t) => {
        if (availableChains.length > 1) {
          if ((t.networkMode || "base") !== chainFilter) return false;
        }
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.address.toLowerCase().includes(s);
      });
  }, [allTokens, excludeAddress, searchTerm, chainFilter, availableChains.length]);

  const filteredTokensRef = useRef(filteredTokens);
  useEffect(() => { filteredTokensRef.current = filteredTokens; }, [filteredTokens]);

  // User-owned tokens not in pool config
  const userOwnedTokens = useMemo(() => {
    return allTokens.filter((token) => {
      if (poolTokenKeySet.has(`${token.address.toLowerCase()}:${token.chainId || ""}`)) return false;
      const balance = tokenBalances[token.address];
      if (!balance) return false;
      const num = parseFloat(balance.balance);
      return !isNaN(num) && num > 0;
    });
  }, [allTokens, tokenBalances, poolTokenKeySet]);

  // ── Search handler ──────────────────────────────────────────────────────
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    if (!value.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        setIsSearching(true);
        const response = await fetch(`/api/tokens/search?q=${encodeURIComponent(value)}&limit=30`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (data.success && data.tokens) setSearchResults(data.tokens);
      } catch (err: any) {
        if (err.name !== "AbortError") console.error("Token search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 200);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
  }, []);

  // Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Auto-focus search
  useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  // ── USD helper ──────────────────────────────────────────────────────────
  const getTokenUsdValue = useCallback((token: TokenSelectorToken): number => {
    if (token.usdPrice && token.balance) {
      const bal = parseFloat(token.balance);
      if (!isNaN(bal) && bal > 0) return bal * token.usdPrice;
    }
    if (token.value) {
      const parsed = parseFloat(token.value.replace(/[~$,]/g, "") || "0");
      if (!isNaN(parsed)) return parsed;
    }
    return 0;
  }, []);

  // ── Fetch prices ────────────────────────────────────────────────────────
  const hasFetchedPricesRef = useRef(false);
  useEffect(() => {
    if (hasFetchedPricesRef.current) return;
    if (filteredTokens.length > 0) {
      hasFetchedPricesRef.current = true;
      const symbols = filteredTokens.map((t) => t.symbol);
      batchQuotePrices(symbols, filterChainId).then(setTokenPrices).catch(() => {});
    }
  }, [filteredTokens, filterChainId]);

  // Reset fetch flags when chain filter changes
  const prevChainRef = useRef(chainFilter);
  useEffect(() => {
    if (prevChainRef.current !== chainFilter) {
      prevChainRef.current = chainFilter;
      hasLoadedRef.current = false;
      hasFetchedPricesRef.current = false;
    }
  }, [chainFilter]);

  // ── Seed user tokens from Portfolio API (runs whenever userTokens arrive) ──
  useEffect(() => {
    if (!isConnected || !accountAddress) return;
    setTokenBalances((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of allTokens) {
        if (!next[t.address] && t.balance && parseFloat(t.balance) > 0) {
          next[t.address] = { balance: t.balance, usdValue: getTokenUsdValue(t), isLoading: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allTokens, isConnected, accountAddress, getTokenUsdValue]);

  // ── Fetch balances ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !accountAddress) {
      const reset: Record<string, TokenBalanceData> = {};
      (filteredTokensRef.current || filteredTokens).forEach((token) => {
        reset[token.address] = { balance: token.balance || "0.00", usdValue: getTokenUsdValue(token), isLoading: false };
      });
      setTokenBalances(reset);
      return;
    }

    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const tokens = filteredTokensRef.current || filteredTokens;
    const initial: Record<string, TokenBalanceData> = {};
    tokens.forEach((t) => {
      initial[t.address] = { balance: t.balance || "...", usdValue: getTokenUsdValue(t), isLoading: true };
    });
    setTokenBalances(initial);

    const fetchBalances = async () => {
      const newBal: Record<string, TokenBalanceData> = {};
      const rawBals: Record<string, { balance: string; numericBalance: number }> = {};

      const native = tokens.find((t) => t.address === "0x0000000000000000000000000000000000000000");
      const erc20s = tokens.filter((t) => t.address !== "0x0000000000000000000000000000000000000000");

      if (native) {
        try {
          const ethBal = await getBalance(config, { address: accountAddress, chainId: filterChainId });
          const balance = formatUnits(ethBal.value, 18);
          const num = parseFloat(balance);
          const display = getFormattedDisplayBalance(num);
          rawBals[native.address] = { balance: display, numericBalance: num };
          newBal[native.address] = { balance: display, usdValue: num * (native.usdPrice || 0), isLoading: false };
        } catch {
          rawBals[native.address] = { balance: "0", numericBalance: 0 };
          newBal[native.address] = { balance: "0", usdValue: 0, isLoading: false };
        }
      }

      if (erc20s.length > 0) {
        const contracts = erc20s.map((t) => ({
          address: t.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [accountAddress] as const,
          chainId: filterChainId,
        }));
        try {
          const results = await readContracts(config, { contracts });
          erc20s.forEach((token, i) => {
            const result = results[i];
            if (result.status === "success") {
              const balance = formatUnits(result.result as bigint, token.decimals);
              const num = parseFloat(balance);
              const display = getFormattedDisplayBalance(num);
              rawBals[token.address] = { balance: display, numericBalance: num };
              newBal[token.address] = { balance: display, usdValue: num * (token.usdPrice || 0), isLoading: false };
            } else {
              rawBals[token.address] = { balance: "0", numericBalance: 0 };
              newBal[token.address] = { balance: "0", usdValue: 0, isLoading: false };
            }
          });
        } catch {
          erc20s.forEach((t) => {
            rawBals[t.address] = { balance: "0", numericBalance: 0 };
            newBal[t.address] = { balance: "0", usdValue: 0, isLoading: false };
          });
        }
      }

      rawBalancesRef.current = rawBals;
      // Merge instead of replace — preserves user tokens seeded from Portfolio API
      setTokenBalances((prev) => ({ ...prev, ...newBal }));
    };

    fetchBalances();
  }, [isConnected, accountAddress, chainFilter, filterChainId, getTokenUsdValue]);

  // Update USD values when prices arrive
  useEffect(() => {
    if (Object.keys(tokenPrices).length === 0) return;
    const raw = rawBalancesRef.current;
    if (Object.keys(raw).length === 0) return;
    setTokenBalances((prev) => {
      const updated = { ...prev };
      const tokens = filteredTokensRef.current || filteredTokens;
      for (const token of tokens) {
        const r = raw[token.address];
        const existing = prev[token.address];
        if (!r || !existing || existing.isLoading) continue;
        const price = tokenPrices[token.symbol] || token.usdPrice || 0;
        updated[token.address] = { ...existing, usdValue: r.numericBalance * price };
      }
      return updated;
    });
  }, [tokenPrices, filteredTokens]);

  // ── Token select ────────────────────────────────────────────────────────
  const handleTokenSelect = (token: TokenSelectorToken) => {
    const balanceData = tokenBalances[token.address];
    const enriched =
      balanceData && !balanceData.isLoading
        ? { ...token, balance: balanceData.balance, value: `~$${balanceData.usdValue.toFixed(2)}` }
        : token;
    onTokenSelect(enriched);
    onClose();
  };

  // Search results → TokenSelectorToken conversion
  const convertSearchResult = (info: TokenInfo): TokenSelectorToken => ({
    address: info.address as `0x${string}`,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    icon: info.logoURI || "/tokens/placeholder.svg",
  });

  // Display tokens
  const displayTokens = useMemo(() => {
    if (searchTerm.trim() && searchResults.length > 0) return searchResults.map(convertSearchResult);
    return filteredTokens;
  }, [searchTerm, searchResults, filteredTokens]);

  // ── Pool tokens for "Supported Tokens" section ─────────────────────────
  const poolTokensFiltered = useMemo(() => {
    return availableTokens
      .filter((t) => (excludeAddress ? t.address.toLowerCase() !== excludeAddress : true))
      .filter((t) => (availableChains.length <= 1 || (t.networkMode || "base") === chainFilter));
  }, [availableTokens, excludeAddress, availableChains.length, chainFilter]);

  // ── User tokens for "Your Tokens" section ──────────────────────────────
  const userTokensFiltered = useMemo(() => {
    return userOwnedTokens
      .filter((t) => (excludeAddress ? t.address.toLowerCase() !== excludeAddress : true))
      .filter((t) => (availableChains.length <= 1 || (t.networkMode || "base") === chainFilter));
  }, [userOwnedTokens, excludeAddress, availableChains.length, chainFilter]);

  // Only show skeleton when pool token balances are still loading (not user tokens — those appear asynchronously)
  const isInitialLoading = Object.keys(tokenBalances).length === 0 && poolTokensFiltered.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <motion.div
      key="token-selector-panel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col flex-1 min-h-0"
    >
      {/* Custom scrollbar styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        .inline-token-scroll::-webkit-scrollbar { width: 4px; }
        .inline-token-scroll::-webkit-scrollbar-track { background: transparent; }
        .inline-token-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        .inline-token-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
        .inline-token-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
      `}} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={onClose}
          className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors"
        >
          <ArrowLeftIcon className="h-5 w-5 text-muted-foreground" />
        </button>
        <h3 className="text-[15px] font-medium tracking-[-0.01em]">Select Token</h3>

        {/* Chain toggle — click to switch between chains */}
        {availableChains.length > 1 && (
          <ChainToggleButton
            availableChains={availableChains}
            chainFilter={chainFilter}
            onToggleChain={setChainFilter}
          />
        )}
      </div>

      {/* ── Search Bar ─────────────────────────────────────────────────── */}
      <div className="relative mb-2">
        <SearchIcon className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
        <Input
          ref={searchInputRef}
          placeholder="Search token or address"
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10 pr-10 h-12 rounded-lg bg-white/[0.03] border-white/[0.06] focus-visible:ring-1 focus-visible:ring-white/[0.12] text-[14px] placeholder:text-muted-foreground/40"
        />
        {isSearching && (
          <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50 animate-spin" />
        )}
      </div>

      {/* ── Token List ─────────────────────────────────────────────────── */}
      <div
        className="flex-1 min-h-0 overflow-y-auto inline-token-scroll -mx-2"
      >
        {/* Loading skeleton */}
        {isInitialLoading && !searchTerm ? (
          <div className="py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 mx-1">
                <div className="w-9 h-9 rounded-full bg-white/[0.04] animate-pulse" />
                <div className="flex-1">
                  <div className="h-4 w-20 bg-white/[0.04] rounded-md animate-pulse mb-1.5" />
                  <div className="h-3 w-10 bg-white/[0.03] rounded-md animate-pulse" />
                </div>
                <div className="text-right">
                  <div className="h-4 w-12 bg-white/[0.04] rounded-md animate-pulse mb-1.5" />
                  <div className="h-3 w-9 bg-white/[0.03] rounded-md animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : displayTokens.length === 0 && !isSearching ? (
          <div className="py-12 text-center">
            <p className="text-[13px] text-muted-foreground/50">
              {searchTerm ? `No tokens found for "${searchTerm}"` : "No tokens available"}
            </p>
          </div>
        ) : (
          <>
            {/* ── Supported Tokens ──────────────────────────────────── */}
            {!searchTerm && (
              <div className="pt-1">
                <div className="px-5 py-1.5">
                  <span className="text-[13px] font-medium text-muted-foreground/60 tracking-[-0.01em]">
                    Supported Tokens
                  </span>
                </div>
                {poolTokensFiltered.map((token) => (
                  <InlineTokenItem
                    key={`pool-${token.address}-${token.chainId || ""}`}
                    token={token}
                    isSelected={selectedToken ? token.address === selectedToken.address : false}
                    balanceData={tokenBalances[token.address]}
                    onClick={() => handleTokenSelect(token)}
                  />
                ))}
              </div>
            )}

            {/* ── Your Tokens ──────────────────────────────────────── */}
            {!searchTerm && isConnected && (userTokensFiltered.length > 0 || isLoadingUserTokens) && (
              <div className="pt-1">
                <div className="mx-4 mb-1 border-t border-white/[0.04]" />
                <div className="px-5 py-1.5">
                  <span className="text-[13px] font-medium text-muted-foreground/60 tracking-[-0.01em]">
                    Your Tokens
                  </span>
                </div>
                {userTokensFiltered.length > 0 ? (
                  userTokensFiltered.map((token) => (
                    <InlineTokenItem
                      key={`yours-${token.address}-${token.chainId || ""}`}
                      token={token}
                      isSelected={selectedToken ? token.address === selectedToken.address : false}
                      balanceData={tokenBalances[token.address]}
                      onClick={() => handleTokenSelect(token)}
                    />
                  ))
                ) : (
                  /* Skeleton rows while user tokens are loading */
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={`skel-${i}`} className="flex items-center gap-3 px-4 py-2.5 mx-1">
                      <div className="w-9 h-9 rounded-full bg-white/[0.04] animate-pulse" />
                      <div className="flex-1">
                        <div className="h-4 w-20 bg-white/[0.04] rounded-md animate-pulse mb-1.5" />
                        <div className="h-3 w-28 bg-white/[0.03] rounded-md animate-pulse" />
                      </div>
                      <div className="text-right">
                        <div className="h-4 w-12 bg-white/[0.04] rounded-md animate-pulse mb-1.5" />
                        <div className="h-3 w-9 bg-white/[0.03] rounded-md animate-pulse" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Search results ────────────────────────────────────── */}
            {searchTerm && (
              <div className="py-1">
                {isSearching && displayTokens.length === 0 ? (
                  <div className="py-8 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
                    <span className="text-[13px] text-muted-foreground/40">Searching...</span>
                  </div>
                ) : (
                  displayTokens.map((token) => {
                    if (token.address.toLowerCase() === excludeAddress) return null;
                    return (
                      <InlineTokenItem
                        key={token.address}
                        token={token}
                        isSelected={selectedToken ? token.address === selectedToken.address : false}
                        balanceData={tokenBalances[token.address]}
                        onClick={() => handleTokenSelect(token)}
                      />
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
