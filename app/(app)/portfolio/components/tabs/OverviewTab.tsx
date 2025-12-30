"use client";

import React from "react";
import { ArrowRight, Clock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import Image from "next/image";
import Link from "next/link";
import type { PortfolioTabId } from "../PortfolioTabs";
import { PortfolioChart } from "../PortfolioChart";
import { ActionGrid } from "../ActionGrid";
import { StatsRow } from "../StatsRow";

// Constants matching Uniswap
const RIGHT_COLUMN_WIDTH = 360;
const MAX_TOKENS_ROWS = 5;
const MAX_POOLS_ROWS = 5;
const MAX_ACTIVITY_ROWS = 5;

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface ActivityItem {
  id: string;
  type: string;
  timestamp: number;
  token0?: { symbol: string; amount: string };
  token1?: { symbol: string; amount: string };
  totalUsdValue?: number;
}

interface OverviewTabProps {
  walletBalances: TokenBalance[];
  activePositions: any[];
  priceMap: Record<string, number>;
  onNavigateToTab: (tab: PortfolioTabId) => void;
  isLoading?: boolean;
  activities?: ActivityItem[];
  totalValue?: number;
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

function formatTokenAmount(amount: number, decimals: number = 4): string {
  if (amount === 0) return "0";
  if (amount < 0.0001) return "< 0.0001";
  return amount.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Section header with title and subtitle (Uniswap pattern)
 */
function SectionHeader({
  title,
  subtitle,
  viewAllLabel,
  onViewAll,
}: {
  title: string;
  subtitle: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      {viewAllLabel && onViewAll && (
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {viewAllLabel}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Table container with consistent styling
 */
function TableContainer({
  children,
  isEmpty,
  emptyMessage,
  emptyAction,
}: {
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyAction?: { label: string; href: string };
}) {
  return (
    <div className="bg-container rounded-xl border border-sidebar-border overflow-hidden">
      {isEmpty ? (
        <div className="py-8 flex flex-col items-center justify-center gap-3">
          <span className="text-sm text-muted-foreground">
            {emptyMessage || "No data"}
          </span>
          {emptyAction && (
            <Link
              href={emptyAction.href}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {emptyAction.label}
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-sidebar-border/50">{children}</div>
      )}
    </div>
  );
}

function TokenRow({ token }: { token: TokenBalance }) {
  const tokenConfig = getToken(token.symbol);
  const iconUrl = (tokenConfig as any)?.icon;

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
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
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
            style={{ backgroundColor: token.color }}
          >
            {token.symbol.slice(0, 2)}
          </div>
        )}
        <div>
          <div className="text-sm font-medium text-foreground">{token.symbol}</div>
          <div className="text-xs text-muted-foreground">
            {formatTokenAmount(token.balance)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-foreground">
          {formatUSD(token.usdValue)}
        </div>
      </div>
    </div>
  );
}

function PositionRow({
  position,
  priceMap,
}: {
  position: any;
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

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2 flex-shrink-0">
          {icon0 ? (
            <div className="w-7 h-7 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image src={icon0} alt={token0} width={28} height={28} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container">
              {token0.slice(0, 2)}
            </div>
          )}
          {icon1 ? (
            <div className="w-7 h-7 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image src={icon1} alt={token1} width={28} height={28} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container">
              {token1.slice(0, 2)}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">
            {token0}/{token1}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                isInRange
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-amber-500/10 text-amber-500"
              )}
            >
              {isInRange ? "In range" : "Out of range"}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-foreground">
          {formatUSD(valueUSD)}
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const token0 = activity.token0?.symbol || "";
  const token1 = activity.token1?.symbol || "";

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0">
          <Clock className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground capitalize">
            {activity.type.replace(/_/g, " ")}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatTimeAgo(activity.timestamp)}
            {token0 && token1 && ` · ${token0}/${token1}`}
          </div>
        </div>
      </div>
      {activity.totalUsdValue && activity.totalUsdValue > 0 && (
        <div className="text-right">
          <div className="text-sm font-medium text-foreground">
            {formatUSD(activity.totalUsdValue)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Loading skeleton for tables
 */
function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-container rounded-xl border border-sidebar-border overflow-hidden">
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 border-b border-sidebar-border/50 last:border-b-0"
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

export function OverviewTab({
  walletBalances,
  activePositions,
  priceMap,
  onNavigateToTab,
  isLoading,
  activities = [],
  totalValue = 0,
}: OverviewTabProps) {
  // Slice to max rows
  const topTokens = walletBalances.slice(0, MAX_TOKENS_ROWS);
  const topPositions = activePositions.slice(0, MAX_POOLS_ROWS);
  const topActivities = activities.slice(0, MAX_ACTIVITY_ROWS);

  // Calculate total value from positions if not provided
  const calculatedTotalValue = totalValue || activePositions.reduce((sum, pos) => {
    const t0 = pos.token0?.symbol || "";
    const t1 = pos.token1?.symbol || "";
    const a0 = parseFloat(pos.token0?.amount || "0");
    const a1 = parseFloat(pos.token1?.amount || "0");
    const p0 = priceMap[t0] || priceMap[t0.toUpperCase()] || 0;
    const p1 = priceMap[t1] || priceMap[t1.toUpperCase()] || 0;
    return sum + a0 * p0 + a1 * p1;
  }, 0);

  if (isLoading) {
    return (
      <div className="flex gap-6 xl:flex-col">
        {/* Left column skeleton */}
        <div className="flex-1 space-y-6 min-w-0">
          <div className="h-[280px] bg-muted/30 rounded-xl border border-sidebar-border animate-pulse" />
          <TableSkeleton rows={4} />
          <TableSkeleton rows={3} />
        </div>
        {/* Right column skeleton */}
        <div className="w-[360px] xl:w-full space-y-4 flex-shrink-0">
          <div className="h-[180px] bg-muted/30 rounded-xl border border-sidebar-border animate-pulse" />
          <div className="h-[80px] bg-muted/30 rounded-xl border border-sidebar-border animate-pulse" />
          <TableSkeleton rows={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-6 xl:flex-col">
      {/* Left Column - Chart + Tables (grows to fill) */}
      <div className="flex-1 space-y-6 min-w-0">
        {/* Portfolio Chart */}
        <PortfolioChart currentValue={calculatedTotalValue} />

        {/* Pools (Positions) Table */}
        <div>
          <SectionHeader
            title="Pools"
            subtitle={`${activePositions.length} open position${activePositions.length !== 1 ? "s" : ""}`}
          />
          <TableContainer
            isEmpty={topPositions.length === 0}
            emptyMessage="No open positions"
            emptyAction={{ label: "New Position", href: "/liquidity" }}
          >
            {topPositions.map((position) => (
              <PositionRow
                key={position.positionId}
                position={position}
                priceMap={priceMap}
              />
            ))}
          </TableContainer>
        </div>

        {/* Tokens Table */}
        <div>
          <SectionHeader
            title="Tokens"
            subtitle={`${walletBalances.length} token${walletBalances.length !== 1 ? "s" : ""}`}
            viewAllLabel="View all"
            onViewAll={() => onNavigateToTab("tokens")}
          />
          <TableContainer
            isEmpty={topTokens.length === 0}
            emptyMessage="No tokens in wallet"
          >
            {topTokens.map((token) => (
              <TokenRow key={token.symbol} token={token} />
            ))}
          </TableContainer>
        </div>
      </div>

      {/* Right Column - Actions + Stats + Activity (fixed width) */}
      <div
        className="flex-shrink-0 space-y-4 xl:w-full"
        style={{ width: RIGHT_COLUMN_WIDTH }}
      >
        {/* Action Tiles (2x2 grid) */}
        <ActionGrid layout="2x2" />

        {/* Stats Row */}
        <StatsRow />

        {/* Activity Table */}
        <div>
          <SectionHeader
            title="Activity"
            subtitle={
              activities.length > 0
                ? `${activities.length} transaction${activities.length !== 1 ? "s" : ""}`
                : "No recent activity"
            }
            viewAllLabel={activities.length > 0 ? "View all" : undefined}
            onViewAll={activities.length > 0 ? () => onNavigateToTab("activity") : undefined}
          />
          <TableContainer
            isEmpty={topActivities.length === 0}
            emptyMessage="No recent activity"
          >
            {topActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </TableContainer>
        </div>
      </div>
    </div>
  );
}

export default OverviewTab;
