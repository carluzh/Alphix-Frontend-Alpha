"use client";

import { memo } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableSectionHeader } from "../shared/TableSectionHeader";
import { ViewAllButton } from "../shared/ViewAllButton";

// Constants matching Uniswap
const TABLE_ROW_HEIGHT = 68;

interface ActivityItem {
  id: string;
  type: string;
  timestamp: number;
  token0?: { symbol: string; amount: string };
  token1?: { symbol: string; amount: string };
  totalUsdValue?: number;
}

interface MiniActivityTableProps {
  activities: ActivityItem[];
  maxRows?: number;
  isLoading?: boolean;
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

function formatFullDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
 * ActivityRow - matches Uniswap's activity row styling
 * Row height: 68px
 * Sliding time cell on hover
 */
function ActivityRow({ activity }: { activity: ActivityItem }) {
  const token0 = activity.token0?.symbol || "";
  const token1 = activity.token1?.symbol || "";
  const amount0 = activity.token0?.amount
    ? parseFloat(activity.token0.amount).toFixed(4)
    : "";

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
      {/* Activity Type + Amount - Left (240px like Uniswap) */}
      <div className="flex items-center gap-2 min-w-[240px] flex-1">
        <div>
          <div className="text-sm text-foreground">
            {token0 && token1 ? (
              <>
                {amount0} {token0} → {token1}
              </>
            ) : (
              <span className="capitalize">
                {activity.type.replace(/_/g, " ")}
              </span>
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
              {formatFullDate(activity.timestamp)}
            </span>
          </div>
        </div>
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
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-16 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-4 w-12 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * MiniActivityTable - matches Uniswap's MiniActivityTable exactly
 *
 * Layout:
 * - TableSectionHeader with title and subtitle
 * - Table rows with 68px height (slightly taller than tokens/pools)
 * - Sliding time cell animation on hover
 * - ViewAllButton at bottom
 */
export const MiniActivityTable = memo(function MiniActivityTable({
  activities,
  maxRows = 5,
  isLoading,
}: MiniActivityTableProps) {
  const displayActivities = activities.slice(0, maxRows);
  const totalActivities = activities.length;

  // Filter activities from past 7 days for subtitle count
  const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const thisWeekCount = activities.filter((a) => a.timestamp > oneWeekAgo).length;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <TableSectionHeader
          title="Activity"
          subtitle="Loading..."
          loading={true}
        />
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  const hasActivities = displayActivities.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <TableSectionHeader
        title={hasActivities ? "Activity" : "No recent activity"}
        subtitle={
          hasActivities
            ? `${thisWeekCount} transaction${thisWeekCount !== 1 ? "s" : ""} this week`
            : "Your transactions will appear here"
        }
      >
        {hasActivities ? (
          <div className="bg-surface/30 rounded-xl overflow-hidden">
            {displayActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        ) : (
          <div
            className="flex items-center gap-2 px-4"
            style={{ height: TABLE_ROW_HEIGHT }}
          >
            <Info className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              No activity this week
            </span>
          </div>
        )}
      </TableSectionHeader>
      <ViewAllButton
        href="/portfolio/activity"
        label="View all activity"
      />
    </div>
  );
});

export default MiniActivityTable;
