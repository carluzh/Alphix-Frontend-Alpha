"use client";

import React from "react";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface TokensTabProps {
  walletBalances: TokenBalance[];
  isLoading?: boolean;
  sortDir: "asc" | "desc";
  onSortChange: (dir: "asc" | "desc") => void;
}

function formatUSD(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "< $0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTokenAmount(amount: number, decimals: number = 6): string {
  if (amount === 0) return "0";
  if (amount < 0.000001) return "< 0.000001";
  return amount.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function TokenRow({ token, index }: { token: TokenBalance; index: number }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-4 py-3 transition-colors hover:bg-surface/50",
        index > 0 && "border-t border-sidebar-border/50"
      )}
    >
      {/* Token Icon + Name */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium text-foreground"
          style={{ backgroundColor: token.color }}
        >
          {token.symbol.slice(0, 2)}
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{token.symbol}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {token.symbol.toLowerCase().includes("usdc") || token.symbol.toLowerCase().includes("usdt")
              ? "Stablecoin"
              : token.symbol.toLowerCase().includes("eth") || token.symbol.toLowerCase().includes("weth")
              ? "Native"
              : "Token"}
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div />

      {/* Balance */}
      <div className="text-right">
        <div className="text-sm font-medium text-foreground">
          {formatTokenAmount(token.balance)}
        </div>
        <div className="text-xs text-muted-foreground">Balance</div>
      </div>

      {/* USD Value */}
      <div className="text-right min-w-[100px]">
        <div className="text-sm font-medium text-foreground">
          {formatUSD(token.usdValue)}
        </div>
        <div className="text-xs text-muted-foreground">Value</div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-0">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={cn(
            "grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-4 py-3",
            i > 1 && "border-t border-sidebar-border/50"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              <div className="h-3 w-12 bg-muted/60 animate-pulse rounded" />
            </div>
          </div>
          <div />
          <div className="text-right space-y-1.5">
            <div className="h-4 w-20 bg-muted animate-pulse rounded ml-auto" />
            <div className="h-3 w-12 bg-muted/60 animate-pulse rounded ml-auto" />
          </div>
          <div className="text-right space-y-1.5 min-w-[100px]">
            <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
            <div className="h-3 w-10 bg-muted/60 animate-pulse rounded ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokensTab({
  walletBalances,
  isLoading,
  sortDir,
  onSortChange,
}: TokensTabProps) {
  const [searchQuery, setSearchQuery] = React.useState("");

  const sortedBalances = React.useMemo(() => {
    let filtered = walletBalances;

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        t.symbol.toLowerCase().includes(query)
      );
    }

    // Sort by value
    return [...filtered].sort((a, b) => {
      if (sortDir === "desc") {
        return b.usdValue - a.usdValue;
      }
      return a.usdValue - b.usdValue;
    });
  }, [walletBalances, searchQuery, sortDir]);

  const totalValue = React.useMemo(() => {
    return walletBalances.reduce((sum, t) => sum + t.usdValue, 0);
  }, [walletBalances]);

  const renderSortIcon = () => {
    if (sortDir === "asc") return <ChevronUpIcon className="h-4 w-4" />;
    if (sortDir === "desc") return <ChevronDownIcon className="h-4 w-4" />;
    return <ChevronsUpDownIcon className="h-4 w-4" />;
  };

  return (
    <div className="space-y-4">
      {/* Header with search and total */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tokens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm bg-container border border-sidebar-border rounded-lg focus:outline-none focus:ring-1 focus:ring-sidebar-primary placeholder:text-muted-foreground"
          />
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total Value</div>
          <div className="text-lg font-semibold text-foreground">
            {formatUSD(totalValue)}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-container rounded-xl border border-sidebar-border overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-4 py-2 bg-surface/30 border-b border-sidebar-border text-xs text-muted-foreground">
          <div className="w-10">Token</div>
          <div />
          <div className="text-right">Balance</div>
          <button
            onClick={() => onSortChange(sortDir === "desc" ? "asc" : "desc")}
            className="flex items-center justify-end gap-1 min-w-[100px] text-right hover:text-foreground transition-colors"
          >
            Value
            {renderSortIcon()}
          </button>
        </div>

        {/* Table Body */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : sortedBalances.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {searchQuery ? "No tokens match your search" : "No tokens in wallet"}
          </div>
        ) : (
          <div>
            {sortedBalances.map((token, index) => (
              <TokenRow key={token.symbol} token={token} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TokensTab;
