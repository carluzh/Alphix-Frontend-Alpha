"use client";

import React, { useState, useMemo } from "react";
import { ArrowDownUp, Plus, Minus, Gift, ExternalLink, Filter, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";

export enum ActivityType {
  SWAP = "swap",
  ADD_LIQUIDITY = "add_liquidity",
  REMOVE_LIQUIDITY = "remove_liquidity",
  MODIFY_LIQUIDITY = "modify_liquidity",
  COLLECT_FEES = "collect_fees",
  UNKNOWN = "unknown",
}

export interface ActivityToken {
  symbol: string;
  amount: string;
  usdValue?: number;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: number;
  txHash: string;
  token0?: ActivityToken;
  token1?: ActivityToken;
  totalUsdValue?: number;
  poolId?: string;
}

interface ActivityTabProps {
  activities: ActivityItem[];
  isLoading?: boolean;
  accountAddress?: string;
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

function getActivityIcon(type: ActivityType) {
  switch (type) {
    case ActivityType.SWAP:
      return <ArrowDownUp className="h-4 w-4" />;
    case ActivityType.ADD_LIQUIDITY:
      return <Plus className="h-4 w-4" />;
    case ActivityType.REMOVE_LIQUIDITY:
      return <Minus className="h-4 w-4" />;
    case ActivityType.COLLECT_FEES:
      return <Gift className="h-4 w-4" />;
    default:
      return <ArrowDownUp className="h-4 w-4" />;
  }
}

function getActivityLabel(type: ActivityType): string {
  switch (type) {
    case ActivityType.SWAP:
      return "Swap";
    case ActivityType.ADD_LIQUIDITY:
      return "Add Liquidity";
    case ActivityType.REMOVE_LIQUIDITY:
      return "Remove Liquidity";
    case ActivityType.COLLECT_FEES:
      return "Collect Fees";
    default:
      return "Transaction";
  }
}

function getActivityColor(type: ActivityType): string {
  switch (type) {
    case ActivityType.SWAP:
      return "bg-blue-500/10 text-blue-500";
    case ActivityType.ADD_LIQUIDITY:
      return "bg-emerald-500/10 text-emerald-500";
    case ActivityType.REMOVE_LIQUIDITY:
      return "bg-amber-500/10 text-amber-500";
    case ActivityType.COLLECT_FEES:
      return "bg-purple-500/10 text-purple-500";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const explorerUrl = getExplorerTxUrl(activity.txHash);

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-surface/50 transition-colors border-b border-sidebar-border/50 last:border-b-0">
      {/* Icon */}
      <div
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center",
          getActivityColor(activity.type)
        )}
      >
        {getActivityIcon(activity.type)}
      </div>

      {/* Activity Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {getActivityLabel(activity.type)}
          </span>
          {activity.token0 && activity.token1 && (
            <span className="text-xs text-muted-foreground">
              {activity.token0.symbol}/{activity.token1.symbol}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatTimeAgo(activity.timestamp)}</span>
          {activity.token0 && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span>
                {parseFloat(activity.token0.amount).toFixed(4)} {activity.token0.symbol}
              </span>
            </>
          )}
          {activity.token1 && activity.type !== ActivityType.SWAP && (
            <>
              <span className="text-muted-foreground/50">+</span>
              <span>
                {parseFloat(activity.token1.amount).toFixed(4)} {activity.token1.symbol}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Value + Link */}
      <div className="flex items-center gap-3">
        {activity.totalUsdValue !== undefined && activity.totalUsdValue > 0 && (
          <div className="text-right">
            <div className="text-sm font-medium text-foreground">
              {formatUSD(activity.totalUsdValue)}
            </div>
          </div>
        )}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-md hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
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
          className="flex items-center gap-4 px-4 py-3 border-b border-sidebar-border/50"
        >
          <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
            <div className="h-3 w-48 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

const FILTER_OPTIONS = [
  { value: "all", label: "All Activity" },
  { value: ActivityType.SWAP, label: "Swaps" },
  { value: ActivityType.ADD_LIQUIDITY, label: "Add Liquidity" },
  { value: ActivityType.REMOVE_LIQUIDITY, label: "Remove Liquidity" },
  { value: ActivityType.COLLECT_FEES, label: "Collect Fees" },
];

export function ActivityTab({
  activities,
  isLoading,
  accountAddress,
}: ActivityTabProps) {
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredActivities = useMemo(() => {
    let filtered = activities;

    // Filter by type
    if (filter !== "all") {
      filtered = filtered.filter((a) => a.type === filter);
    }

    // Filter by search (token symbols)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.token0?.symbol.toLowerCase().includes(query) ||
          a.token1?.symbol.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [activities, filter, searchQuery]);

  const activeFilter = FILTER_OPTIONS.find((f) => f.value === filter);

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by token..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm bg-container border border-sidebar-border rounded-lg focus:outline-none focus:ring-1 focus:ring-sidebar-primary placeholder:text-muted-foreground"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 rounded-lg border border-sidebar-border bg-container hover:bg-surface text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors">
              <Filter className="h-4 w-4" />
              <span>{activeFilter?.label || "Filter"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1 bg-container border-sidebar-border" align="end">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  filter === option.value
                    ? "bg-surface text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface/50"
                )}
              >
                {option.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Activity List */}
      <div className="bg-container rounded-xl border border-sidebar-border overflow-hidden">
        {isLoading ? (
          <LoadingSkeleton />
        ) : filteredActivities.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-sm text-muted-foreground">
              {searchQuery || filter !== "all"
                ? "No activities match your filters"
                : "No recent activity"}
            </div>
            {!accountAddress && (
              <div className="text-xs text-muted-foreground mt-1">
                Connect your wallet to see activity
              </div>
            )}
          </div>
        ) : (
          <div>
            {filteredActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </div>

      {/* Load More - placeholder for pagination */}
      {filteredActivities.length >= 10 && !isLoading && (
        <div className="text-center">
          <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

export default ActivityTab;
