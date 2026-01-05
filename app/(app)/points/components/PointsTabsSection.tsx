"use client";

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { IconClone2, IconCheck, IconChevronLeft, IconChevronRight } from "nucleo-micro-bold-essential";
import { ReferralCodeIcon, EnterCodeIcon } from "@/components/PointsIcons";
import { PointsHistoryTable } from "./PointsHistoryTable";
import { PointsLeaderboardTable } from "./PointsLeaderboardTable";
import type { PointsTab } from "./Points";
import type { PointsHistoryEntry, LeaderboardEntry } from "../hooks/usePointsPageData";

// Tab order for direction detection (matches Uniswap's usePortfolioTabsAnimation)
const TAB_ORDER: PointsTab[] = ["history", "leaderboard", "referral"];

// Animation type (matches Uniswap's AnimationType)
type AnimationType = "forward" | "backward" | "fade";

// Slide distance in pixels (Uniswap uses 10-20px)
const SLIDE_DISTANCE = 20;

// Spring animation config (matches Uniswap's fastHeavy preset)
const SPRING_CONFIG = {
  type: "spring" as const,
  damping: 75,
  stiffness: 1000,
  mass: 1.4,
};

/**
 * usePrevious - Track previous value (matches Uniswap's usePrevious)
 */
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/**
 * Get animation direction based on tab index change
 * (matches Uniswap's usePortfolioTabsAnimation logic)
 */
function getAnimationType(
  currentIndex: number,
  previousIndex: number | undefined
): AnimationType {
  if (previousIndex === undefined) {
    return "fade"; // Initial load
  }
  if (currentIndex > previousIndex) {
    return "forward"; // Moving right = slide in from right
  }
  if (currentIndex < previousIndex) {
    return "backward"; // Moving left = slide in from left
  }
  return "fade";
}

/**
 * Get animation offsets based on direction
 * (matches Uniswap's getAnimationOffsets)
 */
function getAnimationOffsets(animationType: AnimationType, distance: number) {
  switch (animationType) {
    case "forward":
      return { enterOffset: distance, exitOffset: -distance };
    case "backward":
      return { enterOffset: -distance, exitOffset: distance };
    case "fade":
    default:
      return { enterOffset: 0, exitOffset: 0 };
  }
}

interface PointsTabsSectionProps {
  activeTab: PointsTab;
  onTabChange: (tab: PointsTab) => void;
  pointsHistory: PointsHistoryEntry[];
  leaderboardData: LeaderboardEntry[];
  currentUserPosition: number | null;
  currentUserAddress?: string;
  currentUserPoints?: number;
  isLoading?: boolean;
}

/**
 * PointsTabsSection - Full-width tabbed section with History, Leaderboard, and Referral
 *
 * Features:
 * - Tab navigation with animated indicator
 * - Direction-aware content transitions (Uniswap AnimatePresencePager pattern)
 * - Full-width tables below tabs
 */
export const PointsTabsSection = memo(function PointsTabsSection({
  activeTab,
  onTabChange,
  pointsHistory,
  leaderboardData,
  currentUserPosition,
  currentUserAddress,
  currentUserPoints,
  isLoading,
}: PointsTabsSectionProps) {
  // Track tab index for direction detection
  const currentIndex = TAB_ORDER.indexOf(activeTab);
  const previousIndex = usePrevious(currentIndex);

  // Calculate direction on each tab change
  const direction = getAnimationType(currentIndex, previousIndex);

  // Framer Motion variants as a function (receives direction via custom prop)
  // This ensures exiting elements use the correct direction even after state updates
  const variants = {
    initial: (dir: AnimationType) => {
      const { enterOffset } = getAnimationOffsets(dir, SLIDE_DISTANCE);
      return {
        x: enterOffset,
        opacity: 0,
      };
    },
    animate: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: AnimationType) => {
      const { exitOffset } = getAnimationOffsets(dir, SLIDE_DISTANCE);
      return {
        x: exitOffset,
        opacity: 0,
      };
    },
  };

  const renderContent = () => {
    switch (activeTab) {
      case "history":
        return (
          <PointsHistoryTable
            history={pointsHistory}
            isLoading={isLoading}
          />
        );
      case "leaderboard":
        return (
          <PointsLeaderboardTable
            leaderboard={leaderboardData}
            currentUserPosition={currentUserPosition}
            currentUserAddress={currentUserAddress}
            currentUserPoints={currentUserPoints}
            isLoading={isLoading}
          />
        );
      case "referral":
        return <ReferralContent isLoading={isLoading} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={onTabChange} />

      {/* Tab Content with AnimatePresence (matches Uniswap's TransitionItem) */}
      <div className="min-h-[300px] relative overflow-hidden p-px">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={activeTab}
            custom={direction}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SPRING_CONFIG}
            className="w-full"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
});

/**
 * TabNavigation - Styled tab buttons with underline indicator
 */
function TabNavigation({
  activeTab,
  onTabChange,
}: {
  activeTab: PointsTab;
  onTabChange: (tab: PointsTab) => void;
}) {
  const tabs: { id: PointsTab; label: string }[] = [
    { id: "history", label: "History" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "referral", label: "Referral" },
  ];

  return (
    <div className="flex flex-row gap-6 border-b border-sidebar-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            // Base styling
            "relative pb-3 text-sm font-medium transition-colors",
            // Active/inactive states
            activeTab === tab.id
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
            // Focus styles
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary focus-visible:ring-offset-2"
          )}
        >
          {tab.label}

          {/* Active indicator underline */}
          <span
            className={cn(
              "absolute bottom-0 left-0 right-0 h-0.5 rounded-full",
              "transition-all duration-200",
              activeTab === tab.id
                ? "bg-foreground opacity-100"
                : "bg-transparent opacity-0"
            )}
          />
        </button>
      ))}
    </div>
  );
}

// Mock referred users data
interface ReferredUser {
  address: string;
  theirPoints: number;
  yourEarnings: number;
  referredAt: Date;
}

const MOCK_REFERRED_USERS: ReferredUser[] = [
  {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    theirPoints: 12847.5632,
    yourEarnings: 1284.76,
    referredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xabcdef1234567890abcdef1234567890abcdef12",
    theirPoints: 8421.2145,
    yourEarnings: 842.12,
    referredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x9876543210fedcba9876543210fedcba98765432",
    theirPoints: 5632.8891,
    yourEarnings: 563.29,
    referredAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xfedcba9876543210fedcba9876543210fedcba98",
    theirPoints: 3215.4420,
    yourEarnings: 321.54,
    referredAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x5555666677778888999900001111222233334444",
    theirPoints: 1847.1230,
    yourEarnings: 184.71,
    referredAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x6666777788889999aaaabbbbccccddddeeeeffff",
    theirPoints: 1523.8945,
    yourEarnings: 152.39,
    referredAt: new Date(Date.now() - 52 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x7777888899990000aaaabbbbccccddddeeeeffff",
    theirPoints: 1245.6723,
    yourEarnings: 124.57,
    referredAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x8888999900001111aaaabbbbccccddddeeeeffff",
    theirPoints: 987.3456,
    yourEarnings: 98.73,
    referredAt: new Date(Date.now() - 68 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0x9999000011112222aaaabbbbccccddddeeeeffff",
    theirPoints: 756.2134,
    yourEarnings: 75.62,
    referredAt: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xaaaa111122223333bbbbccccddddeeeeffff0000",
    theirPoints: 543.8912,
    yourEarnings: 54.39,
    referredAt: new Date(Date.now() - 82 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xbbbb222233334444ccccddddeeeeffff00001111",
    theirPoints: 412.5678,
    yourEarnings: 41.26,
    referredAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xcccc333344445555ddddeeeeffff000011112222",
    theirPoints: 298.3421,
    yourEarnings: 29.83,
    referredAt: new Date(Date.now() - 98 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xdddd444455556666eeeeffff00001111222233333",
    theirPoints: 187.9045,
    yourEarnings: 18.79,
    referredAt: new Date(Date.now() - 105 * 24 * 60 * 60 * 1000),
  },
  {
    address: "0xeeee555566667777ffff000011112222333344444",
    theirPoints: 123.4567,
    yourEarnings: 12.35,
    referredAt: new Date(Date.now() - 112 * 24 * 60 * 60 * 1000),
  },
];

const TABLE_ROW_HEIGHT = 56;
const ITEMS_PER_PAGE = 10;

/**
 * ReferralContent - Referral tab content with code sharing and referred users table
 */
function ReferralContent({ isLoading }: { isLoading?: boolean }) {
  const referralCode = "ALPHIX-REF-0000"; // Mock referral code
  const discordUrl = "https://discord.gg/alphix"; // Discord server URL
  const [enteredCode, setEnteredCode] = useState("");
  const [isCodeApplied, setIsCodeApplied] = useState(false);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);

  const handleApplyCode = useCallback(() => {
    if (enteredCode.trim()) {
      setAppliedCode(enteredCode.trim());
      setIsCodeApplied(true);
      setEnteredCode("");
    }
  }, [enteredCode]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-32 bg-muted/40 rounded-lg animate-pulse" />
        <div className="h-64 bg-muted/40 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 overflow-visible">
      {/* Gradient animation CSS for referral code card */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes referralGradientFlow {
          from { background-position: 0% 0%; }
          to { background-position: 300% 0%; }
        }
        .referral-gradient-border {
          position: relative;
          border-radius: 8px;
        }
        .referral-gradient-border::before {
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
          animation: referralGradientFlow 10s linear infinite;
        }
      `}} />

      {/* Top Row: Your Code + Enter Code side by side */}
      <div className="flex flex-col min-[900px]:flex-row gap-4 overflow-visible">
        {/* Your Referral Code Card */}
        <div className="flex-1 overflow-visible">
          <div className="referral-gradient-border h-full overflow-visible m-px">
            <div
              className={cn(
                "relative z-[1] rounded-lg",
                "p-5 h-full",
                "bg-container"
              )}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <ReferralCodeIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Your Referral Code
                </span>
              </div>

              {/* Copyable Code Cell */}
              <CopyableReferralCode code={referralCode} />

              {/* Request Custom Link */}
              <div className="mt-3 flex justify-end">
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "text-xs text-muted-foreground underline",
                    "hover:text-foreground transition-colors"
                  )}
                >
                  Request custom code
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Enter Referral Code Card */}
        <div className="flex-1">
          <div
            className={cn(
              "border border-sidebar-border rounded-lg",
              "p-5 h-full",
              "bg-muted/20"
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <EnterCodeIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                Enter Referral Code
              </span>
            </div>

            {/* Input or Applied State */}
            {isCodeApplied && appliedCode ? (
              <div
                className={cn(
                  "rounded-lg border border-green-500/30",
                  "bg-green-500/10",
                  "px-4 py-3 flex items-center justify-between gap-3"
                )}
              >
                <div className="flex items-center gap-2">
                  <IconCheck className="w-4 h-4 text-green-500" />
                  <span
                    className="text-sm font-medium text-foreground"
                    style={{ fontFamily: "Consolas, monospace" }}
                  >
                    {appliedCode}
                  </span>
                </div>
                <span className="text-xs text-green-500">Applied</span>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={enteredCode}
                  onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyCode()}
                  placeholder="ALPHIX-XXX-XXXX"
                  className={cn(
                    "w-full rounded-lg border border-sidebar-border",
                    "bg-muted/40 hover:bg-muted/60 focus:bg-muted/60",
                    "px-4 py-3 text-lg font-medium text-foreground",
                    "placeholder:text-muted-foreground/50",
                    "outline-none focus:ring-1 focus:ring-sidebar-primary/50",
                    "transition-colors"
                  )}
                  style={{ fontFamily: "Consolas, monospace" }}
                />
                {/* Enter kbd hint */}
                {enteredCode.trim() && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted/60 border border-sidebar-border rounded">
                      Enter
                    </kbd>
                  </div>
                )}
              </div>
            )}

            {/* Helper text */}
            <p className="mt-3 text-xs text-muted-foreground">
              {isCodeApplied
                ? "You're earning bonus points for your referrer!"
                : "Your referrer earns 10% of your points - at no cost to you."}
            </p>
          </div>
        </div>
      </div>

      {/* Referred Users Table */}
      <ReferredUsersTable users={MOCK_REFERRED_USERS} isLoading={false} />
    </div>
  );
}

/**
 * CopyableReferralCode - Clickable code cell with copy animation
 * Matches CopyableAddress pattern from Leaderboard
 */
function CopyableReferralCode({ code }: { code: string }) {
  const [isCopied, setIsCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [code]);

  return (
    <div
      className={cn(
        "rounded-lg border border-sidebar-border",
        "bg-muted/40 hover:bg-muted/60",
        "transition-colors cursor-pointer",
        "px-4 py-3 flex items-center justify-between gap-3"
      )}
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className={cn(
          "text-lg font-medium text-foreground",
          "transition-opacity duration-200",
          isHovered ? "opacity-80" : "opacity-100"
        )}
        style={{ fontFamily: "Consolas, monospace" }}
      >
        {code}
      </span>

      {/* Icon container */}
      <div
        className={cn(
          "relative w-5 h-5 flex-shrink-0 transition-opacity duration-200",
          isHovered || isCopied ? "opacity-100" : "opacity-0"
        )}
      >
        <IconClone2
          width={20}
          height={20}
          className={cn(
            "absolute inset-0 text-muted-foreground transition-all duration-200",
            isCopied
              ? "opacity-0 translate-y-1"
              : "opacity-100 translate-y-0"
          )}
        />
        <IconCheck
          width={20}
          height={20}
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
 * Format address for display (truncate middle)
 */
function formatReferralAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format points with proper formatting
 */
function formatReferralPoints(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * ReferredUsersTable - Shows users referred and earnings
 */
function ReferredUsersTable({
  users,
  isLoading,
}: {
  users: ReferredUser[];
  isLoading: boolean;
}) {
  const [currentPage, setCurrentPage] = useState(0);

  const totalItems = users.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);

  const paginatedUsers = users.slice(startIndex, endIndex);

  const canGoPrev = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;

  if (isLoading) {
    return <ReferredUsersLoadingSkeleton />;
  }

  if (users.length === 0) {
    return <ReferredUsersEmptyState />;
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center mb-3">
        <span className="text-sm font-medium text-foreground">Referred Users</span>
      </div>

      {/* Table Header */}
      <div
        className={cn(
          "flex items-center px-4 py-3",
          "bg-muted/50 rounded-lg"
        )}
      >
        <div className="w-32 text-xs text-muted-foreground font-medium">
          Address
        </div>
        <div className="flex-1 text-xs text-muted-foreground font-medium text-right">
          Points
        </div>
        <div className="w-28 text-xs text-muted-foreground font-medium text-right">
          Your Earnings
        </div>
      </div>

      {/* Table Rows */}
      {paginatedUsers.map((user) => (
        <ReferredUserRow key={user.address} user={user} />
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <>
          <div className="h-px bg-sidebar-border mt-2" />
          <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {startIndex + 1}-{endIndex} of {totalItems}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
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
              onClick={() => setCurrentPage((p) => p + 1)}
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
        </>
      )}
    </div>
  );
}

/**
 * ReferredUserRow - Individual row for referred user (no copy - keep addresses incognito)
 * Includes warm hover state (Proposal 4)
 */
function ReferredUserRow({ user }: { user: ReferredUser }) {
  return (
    <div
      className={cn(
        "flex items-center px-4",
        "rounded-lg",
        "transition-all duration-200",
        "hover:bg-muted/40"
      )}
      style={{ height: TABLE_ROW_HEIGHT }}
    >
      {/* Address */}
      <div className="w-32">
        <span
          className="text-sm text-muted-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatReferralAddress(user.address)}
        </span>
      </div>

      {/* Points */}
      <div className="flex-1 text-right">
        <span
          className="text-sm text-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {formatReferralPoints(user.theirPoints)}
        </span>
      </div>

      {/* Your Earnings - Green */}
      <div className="w-28 text-right">
        <span
          className="text-sm font-medium text-green-500"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          +{formatReferralPoints(user.yourEarnings)}
        </span>
      </div>
    </div>
  );
}

/**
 * ReferredUsersEmptyState - No referrals yet
 */
function ReferredUsersEmptyState() {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center mb-3">
        <span className="text-sm font-medium text-foreground">Referred Users</span>
      </div>

      {/* Empty State */}
      <div
        className={cn(
          "flex flex-col items-center justify-center py-12 px-4",
          "border border-sidebar-border rounded-lg",
          "bg-muted/10"
        )}
      >
        <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center mb-3">
          <ReferralCodeIcon className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          No referrals yet
        </h3>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Refer friends to Alphix and <span style={{ color: '#ffffff' }}>earn 10% of their points</span>.
        </p>
      </div>
    </div>
  );
}

/**
 * ReferredUsersLoadingSkeleton - Loading state
 */
function ReferredUsersLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        <div className="h-3 w-12 bg-muted animate-pulse rounded" />
      </div>
      <div className="flex items-center px-4 py-3 bg-muted/50 rounded-lg">
        <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        <div className="flex-1 flex justify-end">
          <div className="h-3 w-20 bg-muted animate-pulse rounded" />
        </div>
        <div className="w-28 flex justify-end">
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
        </div>
      </div>
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="flex items-center px-4"
          style={{ height: TABLE_ROW_HEIGHT }}
        >
          <div className="w-32">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          </div>
          <div className="flex-1 flex justify-end">
            <div className="h-4 w-16 bg-muted animate-pulse rounded" />
          </div>
          <div className="w-28 flex justify-end">
            <div className="h-4 w-14 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default PointsTabsSection;
