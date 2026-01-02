"use client";

import { memo } from "react";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { TableSectionHeader } from "../shared/TableSectionHeader";
import { ViewAllButton } from "../shared/ViewAllButton";

// Constants matching Uniswap
const TABLE_ROW_HEIGHT = 67;

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface MiniTokensTableProps {
  tokens: TokenBalance[];
  maxRows?: number;
  isLoading?: boolean;
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

function formatTokenAmount(amount: number): string {
  if (amount === 0) return "0";
  if (amount < 0.0001) return "< 0.0001";
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/**
 * TokenRow - matches Uniswap's token row styling
 * Row height: 67px
 * Instant hover transition (0ms)
 */
function TokenRow({ token }: { token: TokenBalance }) {
  const tokenConfig = getToken(token.symbol);
  const iconUrl = (tokenConfig as any)?.icon;

  return (
    <div
      className={cn(
        // Layout
        "flex items-center px-4 group cursor-pointer",
        // Hover: instant transition
        "hover:bg-surface/50 transition-[background-color] duration-0"
      )}
      style={{ height: TABLE_ROW_HEIGHT }}
    >
      {/* Token Info - Left */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {iconUrl ? (
          <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0">
            <Image
              src={iconUrl}
              alt={token.symbol}
              width={32}
              height={32}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 text-foreground"
            style={{ backgroundColor: token.color }}
          >
            {token.symbol.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm text-foreground truncate">{token.symbol}</div>
          <div className="text-xs text-muted-foreground">
            {formatTokenAmount(token.balance)}
          </div>
        </div>
      </div>

      {/* Value - Right */}
      <div className="text-right flex-shrink-0">
        <div className="text-sm text-foreground">{formatUSD(token.usdValue)}</div>
      </div>

      {/* Arrow icon (appears on hover) */}
      <div className="ml-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

/**
 * Loading skeleton
 */
function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-surface/30 rounded-xl overflow-hidden">
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-14 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * MiniTokensTable - matches Uniswap's MiniTokensTable exactly
 *
 * Layout:
 * - TableSectionHeader with title and subtitle
 * - Table rows with 67px height
 * - ViewAllButton at bottom
 */
export const MiniTokensTable = memo(function MiniTokensTable({
  tokens,
  maxRows = 8,
  isLoading,
}: MiniTokensTableProps) {
  const displayTokens = tokens.slice(0, maxRows);
  const totalTokens = tokens.length;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <TableSectionHeader
          title="Tokens"
          subtitle="Loading..."
          loading={true}
        />
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TableSectionHeader
        title="Tokens"
        subtitle={`${totalTokens} token${totalTokens !== 1 ? "s" : ""}`}
      >
        {displayTokens.length > 0 ? (
          <div className="bg-surface/30 rounded-xl overflow-hidden">
            {displayTokens.map((token) => (
              <TokenRow key={token.symbol} token={token} />
            ))}
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-4"
            style={{ height: TABLE_ROW_HEIGHT }}
          >
            <span className="text-sm font-medium text-foreground">
              No tokens in wallet
            </span>
          </div>
        )}
      </TableSectionHeader>
      <ViewAllButton href="/portfolio/tokens" label="View all tokens" />
    </div>
  );
});

export default MiniTokensTable;
