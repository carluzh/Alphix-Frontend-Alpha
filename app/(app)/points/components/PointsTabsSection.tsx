"use client";

import { memo, useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { IconClone2, IconCheck, IconChevronLeft, IconChevronRight, IconLink, IconCircleInfo } from "nucleo-micro-bold-essential";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ReferralCodeIcon, EnterCodeIcon } from "@/components/PointsIcons";
import { PointsHistoryTable } from "./PointsHistoryTable";
import { PointsLeaderboardTable } from "./PointsLeaderboardTable";
import type { PointsTab } from "./Points";
import type { PointsHistoryEntry, LeaderboardEntry } from "../hooks/usePointsPageData";
import type { CachedRefereesData } from "@/lib/upstash-points";

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
  // Referral data
  myReferralCode?: string | null;
  getOrCreateReferralCode?: () => Promise<string | null>;
  myReferrer?: string | null;
  myReferrerCode?: string | null;
  referrerJoinedAt?: number | null;
  referees?: CachedRefereesData["referees"];
  applyReferralCode?: (code: string) => Promise<{ success: boolean; error?: string }>;
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
  // Referral data
  myReferralCode,
  getOrCreateReferralCode,
  myReferrer,
  myReferrerCode,
  referrerJoinedAt,
  referees = [],
  applyReferralCode,
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
        return (
          <ReferralContent
            isLoading={isLoading}
            currentUserAddress={currentUserAddress}
            myReferralCode={myReferralCode}
            myReferrer={myReferrer}
            myReferrerCode={myReferrerCode}
            referrerJoinedAt={referrerJoinedAt}
            referees={referees}
            applyReferralCode={applyReferralCode}
          />
        );
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

// Referred user type for the table
interface ReferredUser {
  address: string;
  theirPoints: number;
  yourEarnings: number;
  referredAt: Date;
}

const TABLE_ROW_HEIGHT = 56;
const ITEMS_PER_PAGE = 10;

/**
 * ReferralContent - Referral tab content with code sharing and referred users table
 */
function ReferralContent({
  isLoading,
  currentUserAddress,
  myReferralCode,
  myReferrer,
  myReferrerCode,
  referrerJoinedAt,
  referees = [],
  applyReferralCode,
}: {
  isLoading?: boolean;
  currentUserAddress?: string;
  myReferralCode?: string | null;
  myReferrer?: string | null;
  myReferrerCode?: string | null;
  referrerJoinedAt?: number | null;
  referees?: CachedRefereesData["referees"];
  applyReferralCode?: (code: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const isConnected = !!currentUserAddress;
  const [enteredCode, setEnteredCode] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Check if user doesn't meet requirements
  const requirementsNotMet = myReferralCode === "REQUIREMENTS_NOT_MET";
  const displayCode = requirementsNotMet ? null : myReferralCode;

  const handleApplyCode = useCallback(async () => {
    if (!enteredCode.trim() || !applyReferralCode || isApplying) return;

    setIsApplying(true);
    setApplyError(null);

    try {
      const result = await applyReferralCode(enteredCode.trim());
      if (result.success) {
        setEnteredCode("");
        toast.success("Referral code applied");
      } else {
        setApplyError(result.error || "Failed to apply code");
        toast.error(result.error || "Failed to apply code");
      }
    } catch {
      setApplyError("Failed to apply code");
      toast.error("Failed to apply code");
    } finally {
      setIsApplying(false);
    }
  }, [enteredCode, applyReferralCode, isApplying]);

  // Convert referees to the format expected by ReferredUsersTable
  const referredUsers: ReferredUser[] = referees.map((r) => ({
    address: r.address,
    theirPoints: r.theirPoints,
    yourEarnings: r.yourEarnings,
    referredAt: new Date(r.referredAt),
  }));

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
                "p-5 h-full flex flex-col",
                "bg-container"
              )}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <ReferralCodeIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Your Referral Code
                </span>
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconCircleInfo className="w-3.5 h-3.5 text-muted-foreground/60 cursor-default" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[260px]">
                      <p className="text-xs font-medium mb-1">Requirements</p>
                      <p className="text-xs text-muted-foreground mb-1.5">
                        To create a code you need to LP at least $100 or generate $500 of volume.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Data is verified within 15 min.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Code display - show based on connection/loading/code state */}
              {!isConnected ? (
                <div
                  className={cn(
                    "rounded-lg border border-sidebar-border",
                    "bg-muted/40",
                    "px-3 py-2.5 flex items-center justify-center"
                  )}
                >
                  <span className="text-sm text-muted-foreground">
                    Connect wallet to get your code
                  </span>
                </div>
              ) : displayCode ? (
                <CopyableReferralCode code={displayCode} />
              ) : requirementsNotMet ? (
                <div
                  className={cn(
                    "rounded-lg border border-sidebar-border",
                    "bg-muted/40",
                    "px-3 py-2.5 flex items-center justify-center"
                  )}
                >
                  <span className="text-sm text-muted-foreground">
                    Minimum requirements not met
                  </span>
                </div>
              ) : (
                <div
                  className={cn(
                    "rounded-lg border border-sidebar-border",
                    "bg-muted/40 animate-pulse",
                    "px-3 py-2.5 flex items-center justify-center"
                  )}
                >
                  <span className="text-sm text-muted-foreground">Loading...</span>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Enter Referral Code Card */}
        <div className="flex-1">
          <div
            className={cn(
              "border border-sidebar-border rounded-lg",
              "p-5 h-full flex flex-col",
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
            {myReferrer && myReferrerCode ? (
              <AppliedReferrerDisplay
                code={myReferrerCode}
                joinedAt={referrerJoinedAt}
              />
            ) : enteredCode.trim() ? (
              /* Show Apply button when code is entered */
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex-1 rounded-lg border border-sidebar-border",
                    "bg-muted/40",
                    "px-3 py-2.5 text-sm font-medium text-foreground"
                  )}
                  style={{ fontFamily: "Consolas, monospace" }}
                >
                  {enteredCode}
                </div>
                <button
                  onClick={handleApplyCode}
                  disabled={isApplying}
                  className={cn(
                    "px-4 py-2.5 rounded-lg text-sm font-semibold",
                    "bg-button-primary hover-button-primary text-sidebar-primary",
                    "transition-all active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {isApplying ? "Applying..." : "Apply"}
                </button>
              </div>
            ) : (
              /* Show input when no code entered */
              <input
                type="text"
                value={enteredCode}
                onChange={(e) => setEnteredCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleApplyCode()}
                placeholder="Enter code..."
                disabled={isApplying}
                className={cn(
                  "w-full rounded-lg border border-sidebar-border",
                  "bg-muted/40 hover:bg-muted/60 focus:bg-muted/60",
                  "px-3 py-2.5 text-sm font-medium text-foreground",
                  "placeholder:text-muted-foreground/50",
                  "outline-none focus:border-sidebar-primary/50",
                  "transition-colors",
                  isApplying && "opacity-50 cursor-not-allowed"
                )}
                style={{ fontFamily: "Consolas, monospace" }}
              />
            )}

            {/* Error message */}
            {applyError && (
              <p className="mt-2 text-xs text-red-500">{applyError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Referred Users Table */}
      <ReferredUsersTable users={referredUsers} isLoading={false} />
    </div>
  );
}

/**
 * CopyableReferralCode - Code display with dual copy options (raw code + link)
 */
function CopyableReferralCode({ code }: { code: string }) {
  const [copiedType, setCopiedType] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (copiedType) {
      const timer = setTimeout(() => setCopiedType(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [copiedType]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedType("code");
      toast.success("Referral code copied");
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy code");
    }
  }, [code]);

  const handleCopyLink = useCallback(async () => {
    try {
      // Use overview page as the referral landing page
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://alphix.app";
      const referralLink = `${baseUrl}/overview?ref=${code}`;
      await navigator.clipboard.writeText(referralLink);
      setCopiedType("link");
      toast.success("Referral link copied");
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy link");
    }
  }, [code]);

  return (
    <div className="flex items-center gap-2">
      {/* Code display */}
      <div
        className={cn(
          "flex-1 rounded-lg border border-sidebar-border",
          "bg-muted/40",
          "px-3 py-2.5"
        )}
      >
        <span
          className="text-sm font-medium text-foreground"
          style={{ fontFamily: "Consolas, monospace" }}
        >
          {code}
        </span>
      </div>

      {/* Copy Code button */}
      <button
        onClick={handleCopyCode}
        className={cn(
          "h-10 w-10 flex-shrink-0 rounded-lg",
          "bg-muted/40 hover:bg-muted/60",
          "border border-sidebar-border",
          "flex items-center justify-center",
          "transition-colors"
        )}
        title="Copy code"
      >
        {copiedType === "code" ? (
          <IconCheck width={16} height={16} className="text-green-500" />
        ) : (
          <IconClone2 width={16} height={16} className="text-muted-foreground" />
        )}
      </button>

      {/* Copy Link button */}
      <button
        onClick={handleCopyLink}
        className={cn(
          "h-10 w-10 flex-shrink-0 rounded-lg",
          "bg-muted/40 hover:bg-muted/60",
          "border border-sidebar-border",
          "flex items-center justify-center",
          "transition-colors"
        )}
        title="Copy referral link"
      >
        {copiedType === "link" ? (
          <IconCheck width={16} height={16} className="text-green-500" />
        ) : (
          <IconLink width={16} height={16} className="text-muted-foreground" />
        )}
      </button>
    </div>
  );
}

/**
 * Calculate days remaining until 30-day cooldown expires
 */
function getDaysUntilChangeAllowed(joinedAtMs: number): number {
  const COOLDOWN_DAYS = 30;
  const now = Date.now();
  const cooldownEndMs = joinedAtMs + COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = cooldownEndMs - now;
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

/**
 * AppliedReferrerDisplay - Shows applied referrer code with green badge and cooldown info
 */
function AppliedReferrerDisplay({
  code,
  joinedAt,
}: {
  code: string;
  joinedAt?: number | null;
}) {
  const daysRemaining = joinedAt ? getDaysUntilChangeAllowed(joinedAt) : null;
  const canChange = daysRemaining !== null && daysRemaining === 0;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "rounded-lg border border-green-500/30",
          "bg-green-500/10",
          "px-3 py-2.5 flex items-center justify-between gap-3"
        )}
      >
        <div className="flex items-center gap-2">
          <IconCheck className="w-4 h-4 text-green-500" />
          <span
            className="text-sm font-medium text-foreground"
            style={{ fontFamily: "Consolas, monospace" }}
          >
            {code}
          </span>
        </div>
        <span className="text-xs text-green-500 font-medium">Applied</span>
      </div>
      {daysRemaining !== null && daysRemaining > 0 && (
        <p className="text-xs text-muted-foreground">
          Can change in {daysRemaining} day{daysRemaining !== 1 ? "s" : ""}
        </p>
      )}
      {canChange && (
        <p className="text-xs text-muted-foreground">
          You can now change your referrer
        </p>
      )}
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
