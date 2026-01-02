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

interface Position {
  positionId: string;
  poolId?: string;
  token0?: { symbol: string; amount: string };
  token1?: { symbol: string; amount: string };
  isInRange?: boolean;
  feeTier?: number;
}

interface MiniPoolsTableProps {
  positions: Position[];
  priceMap: Record<string, number>;
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

/**
 * PoolRow - matches Uniswap's pool row styling
 * Row height: 67px
 * Instant hover transition (0ms)
 */
function PoolRow({
  position,
  priceMap,
}: {
  position: Position;
  priceMap: Record<string, number>;
}) {
  const token0 = position.token0?.symbol || "?";
  const token1 = position.token1?.symbol || "?";
  const amt0 = parseFloat(position.token0?.amount || "0");
  const amt1 = parseFloat(position.token1?.amount || "0");
  const price0 = priceMap[token0] || priceMap[token0.toUpperCase()] || 0;
  const price1 = priceMap[token1] || priceMap[token1.toUpperCase()] || 0;
  const valueUSD = amt0 * price0 + amt1 * price1;
  const isInRange = position.isInRange === true;

  const token0Config = getToken(token0);
  const token1Config = getToken(token1);
  const icon0 = (token0Config as any)?.icon;
  const icon1 = (token1Config as any)?.icon;

  // Fee tier
  const feeTier = position.feeTier ? `${position.feeTier / 10000}%` : null;

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
      {/* Pool Info - Left (240px min like Uniswap) */}
      <div className="flex items-center gap-2 min-w-[240px]">
        {/* Split Logo (overlapped tokens) */}
        <div className="flex -space-x-1.5 flex-shrink-0">
          {icon0 ? (
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image
                src={icon0}
                alt={token0}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container text-foreground">
              {token0.slice(0, 2)}
            </div>
          )}
          {icon1 ? (
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image
                src={icon1}
                alt={token1}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container text-foreground">
              {token1.slice(0, 2)}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-foreground">
            {token0} / {token1}
          </div>
          <div className="text-xs text-muted-foreground">
            {feeTier && `${feeTier} · `}v4
          </div>
        </div>
      </div>

      {/* Status - Center */}
      <div className="flex-1 flex justify-end px-4">
        <span
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium",
            isInRange
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-amber-500/10 text-amber-500"
          )}
        >
          {isInRange ? "In range" : "Out of range"}
        </span>
      </div>

      {/* Balance - Right */}
      <div className="text-right flex-shrink-0 min-w-[100px]">
        <div className="text-sm text-foreground">{formatUSD(valueUSD)}</div>
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
          <div className="flex -space-x-1.5">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse border-2 border-container" />
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse border-2 border-container" />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-16 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * MiniPoolsTable - matches Uniswap's MiniPoolsTable exactly
 *
 * Layout:
 * - TableSectionHeader with title and subtitle
 * - Table rows with 67px height
 * - ViewAllButton at bottom
 */
export const MiniPoolsTable = memo(function MiniPoolsTable({
  positions,
  priceMap,
  maxRows = 5,
  isLoading,
}: MiniPoolsTableProps) {
  const displayPositions = positions.slice(0, maxRows);
  const totalPositions = positions.length;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <TableSectionHeader
          title="Pools"
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
        title="Pools"
        subtitle={
          totalPositions > 0
            ? `${totalPositions} open position${totalPositions !== 1 ? "s" : ""}`
            : "No open positions"
        }
      >
        {displayPositions.length > 0 ? (
          <div className="bg-surface/30 rounded-xl overflow-hidden">
            {displayPositions.map((position) => (
              <PoolRow
                key={position.positionId}
                position={position}
                priceMap={priceMap}
              />
            ))}
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-4"
            style={{ height: TABLE_ROW_HEIGHT }}
          >
            <span className="text-sm font-medium text-foreground">
              No liquidity positions
            </span>
          </div>
        )}
      </TableSectionHeader>
      <ViewAllButton href="/liquidity" label="View all pools" />
    </div>
  );
});

export default MiniPoolsTable;
