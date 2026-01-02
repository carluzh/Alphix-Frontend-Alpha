"use client";

import React from "react";
import { ArrowRight, Clock, Plus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import Image from "next/image";
import Link from "next/link";
import type { PortfolioTabId } from "../PortfolioTabs";
import { PortfolioChart } from "../PortfolioChart";
import { ActionGrid } from "../ActionGrid";
import { StatsRow } from "../StatsRow";

// ============================================================================
// CONSTANTS (Matching Uniswap exactly)
// ============================================================================
const OVERVIEW_RIGHT_COLUMN_WIDTH = 360; // px
const SECTION_GAP = 40; // $spacing40
const TABLE_GAP = 40; // $spacing40
const ACTION_STATS_GAP = 16; // $spacing16
const HEADER_GAP = 16; // $gap16
const HEADER_TITLE_GAP = 4; // $gap4
const TABLE_ROW_HEIGHT = 64; // PORTFOLIO_TABLE_ROW_HEIGHT

const MAX_TOKENS_ROWS = 8;
const MAX_POOLS_ROWS = 5;
const MAX_ACTIVITY_ROWS = 5;

// ============================================================================
// TYPES
// ============================================================================
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
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

// ============================================================================
// SEPARATOR COMPONENT (Uniswap style)
// ============================================================================
function Separator() {
  return (
    <div className="w-full h-px bg-sidebar-border" />
  );
}

// ============================================================================
// TABLE SECTION HEADER (Uniswap pattern - TableSectionHeader)
// ============================================================================
function TableSectionHeader({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: HEADER_GAP }}>
      <div style={{ display: "flex", flexDirection: "column", gap: HEADER_TITLE_GAP }}>
        {/* Title: variant="subheading1" color="$neutral1" */}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {/* Subtitle: variant="body3" color="$neutral2" */}
        {subtitle && (
          <span className={cn(
            "text-xs text-muted-foreground",
            loading && "animate-pulse"
          )}>
            {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// VIEW ALL BUTTON (Uniswap pattern)
// ============================================================================
function ViewAllButton({
  href,
  label,
  onClick,
}: {
  href?: string;
  label: string;
  onClick?: () => void;
}) {
  const content = (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </span>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return <button onClick={onClick}>{content}</button>;
}

// ============================================================================
// TABLE CONTAINER (Uniswap v2 table styling)
// ============================================================================
function TableContainer({
  children,
  isEmpty,
  emptyMessage,
  emptyIcon,
  hideHeader,
}: {
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  hideHeader?: boolean;
}) {
  if (isEmpty) {
    return (
      <div
        className="flex items-center gap-2"
        style={{ height: TABLE_ROW_HEIGHT }}
      >
        {emptyIcon || <Info className="h-5 w-5 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">
          {emptyMessage || "No data"}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-surface/30 rounded-xl overflow-hidden">
      {children}
    </div>
  );
}

// ============================================================================
// TABLE ROW BASE (64px height, instant hover)
// ============================================================================
function TableRow({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center px-4 group cursor-pointer",
        // Instant hover transition (0ms) like Uniswap
        "hover:bg-surface/50 transition-[background-color] duration-0",
        className
      )}
      style={{ height: TABLE_ROW_HEIGHT }}
    >
      {children}
    </div>
  );
}

// ============================================================================
// TOKEN ROW (Mini Tokens Table)
// ============================================================================
function TokenRow({ token }: { token: TokenBalance }) {
  const tokenConfig = getToken(token.symbol);
  const iconUrl = (tokenConfig as any)?.icon;

  return (
    <TableRow>
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
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
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
        <div className="text-sm text-foreground">
          {formatUSD(token.usdValue)}
        </div>
      </div>

      {/* Context menu icon (appears on hover) */}
      <div className="ml-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </TableRow>
  );
}

// ============================================================================
// POOL/POSITION ROW (Mini Pools Table)
// ============================================================================
function PoolRow({
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

  // Fee tier (if available)
  const feeTier = position.feeTier ? `${position.feeTier / 10000}%` : null;

  return (
    <TableRow>
      {/* Pool Info - Left (240px min like Uniswap) */}
      <div className="flex items-center gap-2 min-w-[240px]">
        {/* Split Logo (overlapped tokens) */}
        <div className="flex -space-x-1.5 flex-shrink-0">
          {icon0 ? (
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image src={icon0} alt={token0} width={32} height={32} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container">
              {token0.slice(0, 2)}
            </div>
          )}
          {icon1 ? (
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-container bg-muted">
              <Image src={icon1} alt={token1} width={32} height={32} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium border-2 border-container">
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
        <div className="text-sm text-foreground">
          {formatUSD(valueUSD)}
        </div>
      </div>

      {/* Arrow icon (appears on hover) */}
      <div className="ml-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </TableRow>
  );
}

// ============================================================================
// ACTIVITY ROW (Mini Activity Table) - With sliding time cell
// ============================================================================
function ActivityRow({ activity }: { activity: ActivityItem }) {
  const token0 = activity.token0?.symbol || "";
  const token1 = activity.token1?.symbol || "";
  const amount0 = activity.token0?.amount ? parseFloat(activity.token0.amount).toFixed(4) : "";

  // Format full date for hover reveal
  const fullDate = new Date(activity.timestamp * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <TableRow>
      {/* Activity Type + Amount - Left (240px like Uniswap) */}
      <div className="flex items-center gap-2 min-w-[240px] flex-1">
        <div>
          <div className="text-sm text-foreground">
            {token0 && token1 ? (
              <>
                {amount0} {token0} → {token1}
              </>
            ) : (
              <span className="capitalize">{activity.type.replace(/_/g, " ")}</span>
            )}
          </div>
          {activity.totalUsdValue && activity.totalUsdValue > 0 && (
            <div className="text-xs text-muted-foreground">
              {formatUSD(activity.totalUsdValue)}
            </div>
          )}
        </div>
      </div>

      {/* Time - Right (with slide effect on hover) */}
      <div className="text-right flex-shrink-0 min-w-[100px] overflow-hidden relative h-9">
        <div className="absolute inset-0 flex flex-col transition-transform duration-100 ease-in-out group-hover:-translate-y-9">
          {/* Short time (visible by default) */}
          <div className="h-9 flex items-center justify-end">
            <span className="text-sm text-muted-foreground">
              {formatTimeAgo(activity.timestamp)}
            </span>
          </div>
          {/* Full date (revealed on hover) */}
          <div className="h-9 flex items-center justify-end">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {fullDate}
            </span>
          </div>
        </div>
      </div>
    </TableRow>
  );
}

// ============================================================================
// LOADING SKELETONS
// ============================================================================
function TableSkeleton({ rows = 3 }: { rows?: number }) {
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

function ChartSkeleton() {
  return (
    <div
      className="bg-muted/30 rounded-xl border border-sidebar-border animate-pulse flex items-center justify-center"
      style={{ height: 300 }}
    >
      <span className="text-muted-foreground text-sm">Loading chart...</span>
    </div>
  );
}

// ============================================================================
// MAIN OVERVIEW TAB COMPONENT
// ============================================================================
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

  const isPortfolioZero = calculatedTotalValue === 0 && activePositions.length === 0;

  // ========================================================================
  // LOADING STATE
  // ========================================================================
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
        {/* TOP SECTION SKELETON */}
        <div
          className="flex gap-10 xl:flex-col"
          style={{ gap: SECTION_GAP }}
        >
          {/* Chart skeleton - grows */}
          <div className="flex-1 min-w-0">
            <ChartSkeleton />
          </div>
          {/* Right column skeleton - 360px */}
          <div
            className="flex-shrink-0 xl:w-full"
            style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH, display: "flex", flexDirection: "column", gap: ACTION_STATS_GAP }}
          >
            <div className="h-[180px] bg-muted/30 rounded-xl animate-pulse" />
            <div className="h-[80px] bg-muted/30 rounded-xl animate-pulse" />
          </div>
        </div>

        <Separator />

        {/* BOTTOM SECTION SKELETON */}
        <div
          className="flex gap-10 xl:flex-col-reverse"
          style={{ gap: SECTION_GAP }}
        >
          {/* Left column */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: TABLE_GAP }}>
            <TableSkeleton rows={5} />
            <TableSkeleton rows={3} />
          </div>
          {/* Right column */}
          <div
            className="flex-shrink-0 xl:w-full flex flex-col"
            style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH, gap: TABLE_GAP }}
          >
            <TableSkeleton rows={3} />
          </div>
        </div>
      </div>
    );
  }

  // ========================================================================
  // MAIN RENDER
  // ========================================================================
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP, marginBottom: SECTION_GAP }}>

      {/* ================================================================
          TOP SECTION: Chart + Actions/Stats
          Row layout, 40px gap, stacks on xl breakpoint
          ================================================================ */}
      <div
        className="flex xl:flex-col"
        style={{ gap: SECTION_GAP }}
      >
        {/* PORTFOLIO CHART - Left (grows to fill) */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 16 }}>
          <PortfolioChart currentValue={calculatedTotalValue} />
        </div>

        {/* ACTIONS + STATS CONTAINER - Right (360px fixed) */}
        <div
          className="flex-shrink-0 xl:w-full"
          style={{
            width: OVERVIEW_RIGHT_COLUMN_WIDTH,
            display: "flex",
            flexDirection: "column",
            gap: ACTION_STATS_GAP,
            minHeight: isPortfolioZero ? 120 : undefined,
          }}
        >
          {/* Action Tiles (2x2 grid) */}
          <ActionGrid layout="2x2" />

          {/* Stats Row */}
          <StatsRow />
        </div>
      </div>

      {/* ================================================================
          SEPARATOR
          ================================================================ */}
      <Separator />

      {/* ================================================================
          BOTTOM SECTION: 2x2 Tables Grid
          Left: Tokens + Pools (grows)
          Right: Activity (360px)
          Reverses column order on mobile (column-reverse)
          ================================================================ */}
      {!isPortfolioZero && (
        <div
          className="flex xl:flex-col-reverse items-start"
          style={{ gap: SECTION_GAP }}
        >
          {/* LEFT COLUMN: Tokens + Pools (grows, shrinks) */}
          <div
            className="flex-1 min-w-0 flex flex-col xl:w-full"
            style={{ gap: TABLE_GAP }}
          >
            {/* TOKENS TABLE */}
            <div className="flex flex-col" style={{ gap: 12 }}>
              <TableSectionHeader
                title="Tokens"
                subtitle={`${walletBalances.length} total token${walletBalances.length !== 1 ? "s" : ""}`}
                loading={isLoading}
              >
                <TableContainer
                  isEmpty={topTokens.length === 0}
                  emptyMessage="No tokens in wallet"
                >
                  {topTokens.map((token) => (
                    <TokenRow key={token.symbol} token={token} />
                  ))}
                </TableContainer>
              </TableSectionHeader>
              <ViewAllButton
                onClick={() => onNavigateToTab("tokens")}
                label="View all tokens"
              />
            </div>

            {/* POOLS TABLE */}
            <div className="flex flex-col" style={{ gap: 12 }}>
              <TableSectionHeader
                title="Pools"
                subtitle={`${activePositions.length} open position${activePositions.length !== 1 ? "s" : ""}`}
                loading={isLoading}
              >
                <TableContainer
                  isEmpty={topPositions.length === 0}
                  emptyMessage="No open positions"
                  emptyIcon={<Info className="h-5 w-5 text-muted-foreground" />}
                >
                  {topPositions.map((position) => (
                    <PoolRow
                      key={position.positionId}
                      position={position}
                      priceMap={priceMap}
                    />
                  ))}
                </TableContainer>
              </TableSectionHeader>
              <ViewAllButton
                href="/liquidity"
                label="View all pools"
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Activity (360px fixed) */}
          <div
            className="flex-shrink-0 xl:w-full flex flex-col"
            style={{ width: OVERVIEW_RIGHT_COLUMN_WIDTH, gap: TABLE_GAP }}
          >
            {/* ACTIVITY TABLE */}
            <div className="flex flex-col" style={{ gap: 12 }}>
              <TableSectionHeader
                title={topActivities.length > 0 ? "Activity" : "No recent activity"}
                subtitle={
                  topActivities.length > 0
                    ? `${activities.length} transaction${activities.length !== 1 ? "s" : ""} this week`
                    : "Your transactions will appear here"
                }
                loading={isLoading}
              >
                <TableContainer
                  isEmpty={topActivities.length === 0}
                  emptyMessage="No activity this week"
                  hideHeader
                >
                  {topActivities.map((activity) => (
                    <ActivityRow key={activity.id} activity={activity} />
                  ))}
                </TableContainer>
              </TableSectionHeader>
              <ViewAllButton
                onClick={() => onNavigateToTab("activity")}
                label="View all activity"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OverviewTab;
