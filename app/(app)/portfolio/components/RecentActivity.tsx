"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import { getToken } from "@/lib/pools-config";
import { ArrowLeftRight, Plus, Minus, Coins, ExternalLink, Activity } from "lucide-react";
import {
  useRecentActivity,
  formatTimeAgo,
  ActivityType,
  type ActivityItem,
} from "../hooks/useRecentActivity";

interface RecentActivityProps {
  className?: string;
  maxItems?: number;
  /** Override activities (for when hook is managed externally) */
  activities?: ActivityItem[];
  isLoading?: boolean;
}

/**
 * Get icon for activity type
 */
function getActivityIcon(type: ActivityType) {
  switch (type) {
    case ActivityType.SWAP:
      return <ArrowLeftRight className="h-4 w-4" />;
    case ActivityType.ADD_LIQUIDITY:
      return <Plus className="h-4 w-4" />;
    case ActivityType.REMOVE_LIQUIDITY:
      return <Minus className="h-4 w-4" />;
    case ActivityType.COLLECT_FEES:
      return <Coins className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

/**
 * Get background color for activity type
 */
function getActivityColor(type: ActivityType): string {
  switch (type) {
    case ActivityType.SWAP:
      return "bg-blue-500/10 text-blue-500";
    case ActivityType.ADD_LIQUIDITY:
      return "bg-green-500/10 text-green-500";
    case ActivityType.REMOVE_LIQUIDITY:
      return "bg-red-500/10 text-red-500";
    case ActivityType.COLLECT_FEES:
      return "bg-yellow-500/10 text-yellow-500";
    default:
      return "bg-muted/50 text-muted-foreground";
  }
}

/**
 * Single activity row
 */
function ActivityRow({ activity }: { activity: ActivityItem }) {
  const token0Info = activity.token0?.symbol ? getToken(activity.token0.symbol) : null;
  const token1Info = activity.token1?.symbol ? getToken(activity.token1.symbol) : null;

  const explorerUrl = `https://basescan.org/tx/${activity.txHash}`;

  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-muted/20 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        {/* Activity type icon */}
        <div className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0",
          getActivityColor(activity.type)
        )}>
          {getActivityIcon(activity.type)}
        </div>

        {/* Activity details */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Token icons */}
            {token0Info && (
              <div className="flex items-center -space-x-1">
                <div className="w-5 h-5 rounded-full overflow-hidden bg-main border border-sidebar-border">
                  <Image
                    src={(token0Info as any)?.icon || "/placeholder.svg"}
                    alt={activity.token0?.symbol || ""}
                    width={20}
                    height={20}
                    className="w-full h-full object-cover"
                  />
                </div>
                {token1Info && (
                  <div className="w-5 h-5 rounded-full overflow-hidden bg-main border border-sidebar-border">
                    <Image
                      src={(token1Info as any)?.icon || "/placeholder.svg"}
                      alt={activity.token1?.symbol || ""}
                      width={20}
                      height={20}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Amount text */}
            <span className="text-sm text-foreground truncate">
              {activity.token0 && (
                <>
                  {activity.token0.amount} {activity.token0.symbol}
                </>
              )}
              {activity.type === ActivityType.SWAP && activity.token1 && (
                <>
                  {" → "}
                  {activity.token1.amount} {activity.token1.symbol}
                </>
              )}
            </span>
          </div>

          {/* Time */}
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatTimeAgo(activity.timestamp)}
          </div>
        </div>
      </div>

      {/* Right side: value and link */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {activity.totalUsdValue && activity.totalUsdValue > 0 && (
          <span className="text-sm text-muted-foreground">
            {formatUSD(activity.totalUsdValue)}
          </span>
        )}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

/**
 * Loading skeleton for activity row
 */
function ActivityRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 px-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted/60 animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
          <div className="h-3 w-20 bg-muted/60 rounded animate-pulse" />
        </div>
      </div>
      <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
    </div>
  );
}

/**
 * Recent Activity component
 * Adapted from Uniswap's MiniActivityTable.tsx
 *
 * SHORTCUT NOTE:
 * This requires the /api/portfolio/activity endpoint to be implemented.
 * The endpoint should query user transactions from the subgraph.
 */
export function RecentActivity({
  className,
  maxItems = 5,
  activities: externalActivities,
  isLoading: externalLoading,
}: RecentActivityProps) {
  // Use hook if no external activities provided
  const { activities: hookActivities, isLoading: hookLoading } = useRecentActivity(maxItems);

  const activities = externalActivities || hookActivities;
  const isLoading = externalLoading !== undefined ? externalLoading : hookLoading;

  const displayActivities = activities.slice(0, maxItems);

  return (
    <div className={cn("rounded-lg border border-sidebar-border bg-container overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div>
          <div className="text-sm font-medium text-foreground">Recent Activity</div>
          {!isLoading && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {displayActivities.length > 0
                ? `${displayActivities.length} transaction${displayActivities.length === 1 ? "" : "s"} this week`
                : "No recent activity"}
            </div>
          )}
        </div>
        {displayActivities.length > 0 && (
          <Link
            href="/portfolio/activity"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View All
          </Link>
        )}
      </div>

      {/* Activity list */}
      <div className="divide-y divide-sidebar-border/60">
        {isLoading ? (
          // Loading skeletons
          <>
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </>
        ) : displayActivities.length > 0 ? (
          // Activity rows
          displayActivities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))
        ) : (
          // Empty state
          <div className="py-8 text-center">
            <Activity className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <div className="text-sm text-muted-foreground">
              No recent activity
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Your transactions will appear here
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RecentActivity;
