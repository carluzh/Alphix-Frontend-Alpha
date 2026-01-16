"use client";

import { memo, useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PointsIcon } from "@/components/PointsIcons";
import { IconChevronLeft, IconChevronRight } from "nucleo-micro-bold-essential";
import type { PointsHistoryEntry } from "../hooks/usePointsPageData";

// Constants
const TABLE_ROW_HEIGHT = 56;
const ITEMS_PER_PAGE = 10;

interface PointsHistoryTableProps {
  history: PointsHistoryEntry[];
  isLoading?: boolean;
}

/**
 * Format date as "2. Oct."
 */
function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${day}. ${month}.`;
}

/**
 * Format date range for weekly drops
 */
function formatDateRange(startDate?: number, endDate?: number): string {
  if (!startDate || !endDate) return "-";
  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

/**
 * Format points with + sign
 */
function formatPoints(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

/**
 * PointsHistoryTable - Shows user's points earning history
 */
export const PointsHistoryTable = memo(function PointsHistoryTable({
  history,
  isLoading,
}: PointsHistoryTableProps) {
  const [currentPage, setCurrentPage] = useState(0);

  // Pagination calculations
  const totalItems = history.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);

  const paginatedHistory = useMemo(() => {
    return history.slice(startIndex, endIndex);
  }, [history, startIndex, endIndex]);

  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  if (isLoading) {
    return <LoadingSkeleton rows={5} />;
  }

  if (history.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col">
      {/* Header Row */}
      <HeaderRow />

      {/* Data Rows */}
      {paginatedHistory.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <>
          <div className="h-px bg-sidebar-border mt-2" />
          <PaginationControls
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={totalItems}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPrev={() => setCurrentPage((p) => p - 1)}
          onNext={() => setCurrentPage((p) => p + 1)}
        />
        </>
      )}
    </div>
  );
});

/**
 * PaginationControls - Navigation for table pages
 */
function PaginationControls({
  startIndex,
  endIndex,
  totalItems,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: {
  startIndex: number;
  endIndex: number;
  totalItems: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-xs text-muted-foreground">
        {startIndex + 1}-{endIndex} of {totalItems}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onPrev}
          disabled={!canGoPrev}
          className={cn(
            "h-6 w-6 flex items-center justify-center rounded transition-colors",
            canGoPrev
              ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              : "text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          <IconChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className={cn(
            "h-6 w-6 flex items-center justify-center rounded transition-colors",
            canGoNext
              ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              : "text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          <IconChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * HeaderRow - Table column headers
 */
function HeaderRow() {
  return (
    <div
      className={cn(
        "flex items-center px-4 py-3",
        "bg-muted/50 rounded-lg"
      )}
    >
      <div className="w-32 text-xs text-muted-foreground font-medium">
        Activity
      </div>
      <div className="flex-1 text-xs text-muted-foreground font-medium">
        Time
      </div>
      <div className="w-28 text-xs text-muted-foreground font-medium text-right">
        Points
      </div>
    </div>
  );
}

/**
 * HistoryRow - Individual history entry
 */
function HistoryRow({ entry }: { entry: PointsHistoryEntry }) {
  const isWeeklyDrop = entry.type === "weekly_drop";

  // Activity text - Season/Week as title, type as subtext
  const activityTitle = isWeeklyDrop
    ? `S${entry.season}W${entry.week}`
    : "Referral Bonus";
  const activitySubtext = isWeeklyDrop
    ? "Weekly Drop"
    : `${entry.referralCount} referral${entry.referralCount !== 1 ? "s" : ""}`;

  // Time text - date range for weekly drops, single date for referrals
  const timeText = isWeeklyDrop
    ? formatDateRange(entry.startDate, entry.endDate)
    : entry.timestamp
      ? formatShortDate(entry.timestamp)
      : "-";

  return (
    <div
      className={cn(
        "flex items-center px-4 group",
        "rounded-lg cursor-default",
        "transition-all duration-200",
        "hover:bg-muted/40"
      )}
      style={{ height: TABLE_ROW_HEIGHT }}
    >
      {/* Activity Info - No icons */}
      <div className="w-32 min-w-0">
        <div className="text-sm text-foreground">
          {activityTitle}
        </div>
        <div className="text-xs text-muted-foreground">
          {activitySubtext}
        </div>
      </div>

      {/* Time */}
      <div className="flex-1">
        <span
          className="text-sm text-muted-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {timeText}
        </span>
      </div>

      {/* Points */}
      <div className="w-28 text-right">
        <span
          className={cn(
            "text-sm font-semibold",
            entry.points >= 0 ? "text-green-500" : "text-foreground"
          )}
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatPoints(entry.points)}
        </span>
      </div>
    </div>
  );
}

/**
 * EmptyState - No history to display
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-lg bg-muted/40 flex items-center justify-center mb-4">
        <PointsIcon className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1">
        No points history yet
      </h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        Start earning points by providing liquidity in{" "}
        <Link href="/liquidity" className="underline hover:text-foreground transition-colors">
          Unified Pools
        </Link>.
        Your earning history will appear here.
      </p>
    </div>
  );
}

/**
 * LoadingSkeleton - Loading state
 */
function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {/* Header skeleton */}
      <div className="flex items-center px-4 py-3 bg-muted/50 rounded-lg">
        <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        <div className="flex-1" />
        <div className="h-3 w-32 bg-muted animate-pulse rounded mr-6" />
        <div className="h-3 w-14 bg-muted animate-pulse rounded" />
      </div>

      {/* Row skeletons */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-12 bg-muted/60 animate-pulse rounded" />
          </div>
          <div className="h-3 w-32 bg-muted animate-pulse rounded mr-6" />
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

export default PointsHistoryTable;
