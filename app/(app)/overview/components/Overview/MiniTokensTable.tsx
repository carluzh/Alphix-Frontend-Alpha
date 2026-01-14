"use client";

import { memo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { TableSectionHeader } from "../shared/TableSectionHeader";
import { ChevronRight } from "lucide-react";

// Constants matching Uniswap PORTFOLIO_TABLE_ROW_HEIGHT
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
  return amount.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * HeaderRow - matches Uniswap's v2 HeaderRow styling
 * backgroundColor: $surface2, borderRadius: $rounded12
 */
function HeaderRow() {
  return (
    <div
      className={cn(
        "flex items-center px-4 py-3",
        "bg-muted/50 rounded-xl"
      )}
    >
      <div className="flex-1 text-xs text-muted-foreground font-medium">
        Token
      </div>
      <div className="text-xs text-muted-foreground font-medium text-right">
        Value
      </div>
    </div>
  );
}

/**
 * TokenRow - matches Uniswap's v2 DataRow styling
 * Clickable: navigates to /liquidity?token=SYMBOL
 * hoverStyle: backgroundColor with transition 0ms, shows arrow on hover
 */
function TokenRow({ token, onClick }: { token: TokenBalance; onClick?: () => void }) {
  const tokenConfig = getToken(token.symbol);
  const iconUrl = (tokenConfig as any)?.icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center px-4 group",
        "hover:bg-muted/40 rounded-xl",
        onClick && "cursor-pointer"
      )}
      style={{
        height: TABLE_ROW_HEIGHT,
        transition: "background-color 0ms",
      }}
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
      <div className="flex items-center flex-shrink-0">
        <div className="text-right">
          <div className="text-sm text-foreground">{formatUSD(token.usdValue)}</div>
        </div>
        {onClick && (
          <ChevronRight className="h-4 w-0 group-hover:w-4 ml-0 group-hover:ml-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all overflow-hidden" />
        )}
      </div>
    </div>
  );
}

/**
 * Loading skeleton - matches Uniswap table loading pattern
 */
function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header skeleton */}
      <div className="flex items-center px-4 py-3 bg-muted/50 rounded-xl">
        <div className="h-3 w-12 bg-muted animate-pulse rounded" />
        <div className="flex-1" />
        <div className="h-3 w-10 bg-muted animate-pulse rounded" />
      </div>
      {/* Row skeletons */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-12 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-4 w-14 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * MiniTokensTable - matches Uniswap's v2 table pattern
 *
 * Structure (separate containers like Uniswap v2):
 * - TableSectionHeader with title and subtitle
 * - HeaderRow (rounded, surface2 bg)
 * - Token rows (instant hover, rounded, clickable to filter liquidity)
 * - No ViewAllButton
 */
export const MiniTokensTable = memo(function MiniTokensTable({
  tokens,
  maxRows = 8,
  isLoading,
}: MiniTokensTableProps) {
  const router = useRouter();
  const displayTokens = tokens.slice(0, maxRows);
  const totalTokens = tokens.length;

  const handleTokenClick = (symbol: string) => {
    router.push(`/liquidity?token=${encodeURIComponent(symbol)}`);
  };

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
          <div className="flex flex-col">
            <HeaderRow />
            {displayTokens.map((token) => (
              <TokenRow
                key={token.symbol}
                token={token}
                onClick={() => handleTokenClick(token.symbol)}
              />
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
    </div>
  );
});

export default MiniTokensTable;
