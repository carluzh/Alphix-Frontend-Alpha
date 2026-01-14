"use client";

import { memo, useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { IconAward, IconChevronLeft, IconChevronRight, IconClone2, IconCheck } from "nucleo-micro-bold-essential";
import type { LeaderboardEntry } from "../hooks/usePointsPageData";

// Constants
const TABLE_ROW_HEIGHT = 56;
const ITEMS_PER_PAGE = 10;

interface PointsLeaderboardTableProps {
  leaderboard: LeaderboardEntry[];
  currentUserPosition: number | null;
  currentUserAddress?: string;
  currentUserPoints?: number;
  isLoading?: boolean;
}

/**
 * Format address for display (truncate middle)
 */
function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format points with proper formatting
 */
function formatPoints(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Get medal style for top 3 positions
 */
function getRankStyle(rank: number): { bg: string; text: string } | null {
  switch (rank) {
    case 1:
      return { bg: "bg-yellow-500/20", text: "text-yellow-400" };
    case 2:
      return { bg: "bg-gray-400/20", text: "text-gray-300" };
    case 3:
      return { bg: "bg-amber-600/20", text: "text-amber-500" };
    default:
      return null;
  }
}

/**
 * PointsLeaderboardTable - Shows points leaderboard rankings
 */
export const PointsLeaderboardTable = memo(function PointsLeaderboardTable({
  leaderboard,
  currentUserPosition,
  currentUserAddress,
  currentUserPoints,
  isLoading,
}: PointsLeaderboardTableProps) {
  const [currentPage, setCurrentPage] = useState(0);

  // Pagination calculations
  const totalItems = leaderboard.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);

  const paginatedLeaderboard = useMemo(() => {
    return leaderboard.slice(startIndex, endIndex);
  }, [leaderboard, startIndex, endIndex]);

  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  // Check if user is visible on current page
  const isUserOnCurrentPage = useMemo(() => {
    if (!currentUserPosition) return false;
    return currentUserPosition > startIndex && currentUserPosition <= endIndex;
  }, [currentUserPosition, startIndex, endIndex]);

  // Show user row at top only when they're NOT on the current page
  const showUserRowAtTop = currentUserPosition && !isUserOnCurrentPage;

  if (isLoading) {
    return <LoadingSkeleton rows={10} />;
  }

  if (leaderboard.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col">
      {/* Gradient animation CSS for current user row */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes leaderboardGradientFlow {
          from { background-position: 0% 0%; }
          to { background-position: 300% 0%; }
        }
        .leaderboard-gradient-border {
          position: relative;
          border-radius: 8px;
        }
        .leaderboard-gradient-border::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 9px;
          background: linear-gradient(
            45deg,
            #f94706,
            #ff7919 25%,
            #f94706 50%,
            #ff7919 75%,
            #f94706 100%
          );
          background-size: 300% 100%;
          opacity: 1;
          pointer-events: none;
          z-index: 0;
          animation: leaderboardGradientFlow 10s linear infinite;
        }
      `}} />

      {/* Current user position at TOP (if not visible in current page) */}
      {showUserRowAtTop && (
        <CurrentUserRow
          position={currentUserPosition}
          address={currentUserAddress}
          points={currentUserPoints}
        />
      )}

      {/* Header Row */}
      <HeaderRow />

      {/* Data Rows */}
      {paginatedLeaderboard.map((entry) => (
        <LeaderboardRow
          key={entry.address}
          entry={entry}
          isCurrentUser={entry.rank === currentUserPosition}
        />
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
      <div className="w-20 text-xs text-muted-foreground font-medium">
        Rank
      </div>
      <div className="flex-1 text-xs text-muted-foreground font-medium">
        Address
      </div>
      <div className="w-32 text-xs text-muted-foreground font-medium text-right">
        Points
      </div>
    </div>
  );
}

/**
 * CopyableAddress - Address with copy icon animation on hover/click
 * Matches AddressDisplay pattern from Overview
 */
function CopyableAddress({
  address,
}: {
  address: string;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Reset copied state after timeout
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setIsCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [address]);

  return (
    <div
      className="flex items-center gap-1.5 cursor-pointer"
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className={cn(
          "text-sm text-foreground transition-opacity duration-200",
          isHovered ? "opacity-80" : "opacity-100"
        )}
      >
        {formatAddress(address)}
      </span>
      <div
        className={cn(
          "relative w-3 h-3 transition-opacity duration-200",
          isHovered || isCopied ? "opacity-100" : "opacity-0"
        )}
      >
        <IconClone2
          width={12}
          height={12}
          className={cn(
            "absolute inset-0 text-muted-foreground transition-all duration-200",
            isCopied
              ? "opacity-0 translate-y-1"
              : "opacity-100 translate-y-0"
          )}
        />
        <IconCheck
          width={12}
          height={12}
          className={cn(
            "absolute inset-0 text-green-500 transition-all duration-200",
            isCopied
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-1"
          )}
        />
      </div>
    </div>
  );
}

/**
 * "You" Badge - White text with rounded background
 */
function YouBadge() {
  return (
    <span className="text-xs text-sidebar-primary font-medium px-1.5 py-0.5 bg-button-primary rounded">
      You
    </span>
  );
}

/**
 * LeaderboardRow - Individual leaderboard entry
 */
function LeaderboardRow({
  entry,
  isCurrentUser,
}: {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
}) {
  const rankStyle = getRankStyle(entry.rank);

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
      {/* Rank */}
      <div className="w-20">
        {rankStyle ? (
          <div
            className={cn(
              "inline-flex items-center justify-center",
              "w-8 h-8 rounded-full",
              rankStyle.bg
            )}
          >
            <span className={cn("text-sm font-bold", rankStyle.text)}>
              {entry.rank}
            </span>
          </div>
        ) : (
          <span
            className="text-sm text-muted-foreground"
            style={{ fontFamily: "Consolas, monospace" }}
          >
            #{entry.rank}
          </span>
        )}
      </div>

      {/* Address */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <CopyableAddress address={entry.address} />
        {isCurrentUser && <YouBadge />}
      </div>

      {/* Points - White/Basic */}
      <div className="w-32 text-right">
        <span
          className="text-sm font-medium text-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatPoints(entry.points)}
        </span>
      </div>
    </div>
  );
}

/**
 * CurrentUserRow - Shows current user's position at top
 */
function CurrentUserRow({
  position,
  address,
  points,
}: {
  position: number;
  address?: string;
  points?: number;
}) {
  return (
    <div className="leaderboard-gradient-border mb-3 overflow-visible m-px">
      <div
        className={cn(
          "relative z-[1] flex items-center px-4",
          "bg-container rounded-lg"
        )}
        style={{ height: TABLE_ROW_HEIGHT }}
      >
        <div className="w-20">
          <span
            className="text-sm text-muted-foreground"
            style={{ fontFamily: "Consolas, monospace" }}
          >
            #{position}
          </span>
        </div>
        <div className="flex-1 flex items-center gap-2">
          {address ? (
            <CopyableAddress address={address} />
          ) : (
            <span className="text-sm text-foreground">Your Position</span>
          )}
          <YouBadge />
        </div>
        <div className="w-32 text-right">
          <span
            className="text-sm font-medium text-foreground"
            style={{ fontFamily: "Consolas, monospace" }}
          >
            {points !== undefined ? formatPoints(points) : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * EmptyState - No leaderboard data
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center mb-4">
        <IconAward className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1">
        Leaderboard coming soon
      </h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        The points leaderboard will be available once more users start earning points.
        Be among the first to climb the ranks!
      </p>
    </div>
  );
}

/**
 * LoadingSkeleton - Loading state
 */
function LoadingSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {/* Header skeleton */}
      <div className="flex items-center px-4 py-3 bg-muted/50 rounded-lg">
        <div className="h-3 w-10 bg-muted animate-pulse rounded" />
        <div className="flex-1 ml-6">
          <div className="h-3 w-14 bg-muted animate-pulse rounded" />
        </div>
        <div className="h-3 w-12 bg-muted animate-pulse rounded" />
      </div>

      {/* Row skeletons */}
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="w-20">
            {i < 3 ? (
              <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
            ) : (
              <div className="h-4 w-8 bg-muted animate-pulse rounded" />
            )}
          </div>
          <div className="flex-1">
            <div className="h-4 w-28 bg-muted animate-pulse rounded" />
          </div>
          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

export default PointsLeaderboardTable;
