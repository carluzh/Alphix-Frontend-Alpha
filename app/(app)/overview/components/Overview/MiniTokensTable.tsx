"use client";

import { memo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
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

function formatTokenAmount(amount: number): string {
  if (amount === 0) return "0";
  if (amount < 0.0001) return "< 0.0001";
  return amount.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * HeaderRow - with enhanced surface treatment
 */
function HeaderRow() {
  return (
    <div
      className={cn(
        "flex items-center px-4 py-3",
        "bg-muted/50 rounded-xl",
        "surface-depth"
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
 * TokenRow - with staggered entry animation
 */
function TokenRow({
  token,
  onClick,
  index = 0,
}: {
  token: TokenBalance;
  onClick?: () => void;
  index?: number;
}) {
  const tokenConfig = getToken(token.symbol);
  const iconUrl = (tokenConfig as any)?.icon;
  const prefersReducedMotion = useReducedMotion();

  const formatUsdValue = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const rowContent = (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center px-4 group",
        "rounded-xl",
        "transition-colors duration-200",
        "hover:bg-muted/40",
        onClick && "cursor-pointer"
      )}
      style={{
        height: TABLE_ROW_HEIGHT,
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
          <div className="text-sm text-foreground truncate font-medium">{token.symbol}</div>
          <div className="text-xs text-muted-foreground">
            {formatTokenAmount(token.balance)}
          </div>
        </div>
      </div>

      {/* Value - Right */}
      <div className="flex items-center flex-shrink-0">
        <div className="text-right">
          <span className="text-sm text-foreground">{formatUsdValue(token.usdValue)}</span>
        </div>
        {onClick && (
          <ChevronRight className="h-4 w-0 group-hover:w-4 ml-0 group-hover:ml-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 overflow-hidden" />
        )}
      </div>
    </div>
  );

  // Wrap in motion.div for entry animation
  if (prefersReducedMotion) {
    return rowContent;
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: 0.35 + index * 0.04,
        duration: 0.3,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      {rowContent}
    </motion.div>
  );
}

/**
 * Loading skeleton
 */
function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header skeleton */}
      <div className="flex items-center px-4 py-3 bg-muted/50 rounded-xl surface-depth">
        <div className="h-3 w-12 bg-muted/60 animate-pulse rounded" />
        <div className="flex-1" />
        <div className="h-3 w-10 bg-muted/60 animate-pulse rounded" />
      </div>
      {/* Row skeletons */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="w-8 h-8 rounded-full bg-muted/60 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-16 bg-muted/60 animate-pulse rounded" />
            <div className="h-2.5 w-12 bg-muted/40 animate-pulse rounded" />
          </div>
          <div className="h-4 w-14 bg-muted/60 animate-pulse rounded" />
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
            {displayTokens.map((token, index) => (
              <TokenRow
                key={token.symbol}
                token={token}
                index={index}
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
