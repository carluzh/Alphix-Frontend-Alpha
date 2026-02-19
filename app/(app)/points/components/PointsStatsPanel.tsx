"use client";

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { IconChevronRight } from "nucleo-micro-bold-essential";
import { VolumeIcon, LiquidityIcon, ReferralIcon, RankIcon, UsersIcon, PercentileIcon, PointsIcon } from "@/components/PointsIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PointsTab } from "./Points";

// Simple fade animation config
const FADE_TRANSITION = {
  duration: 0.15,
  ease: "easeOut",
};

// Fade-only variants (no movement)
const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

interface PointsStatsPanelProps {
  activeTab: PointsTab;
  leaderboardPosition: number | null;
  totalParticipants: number;
  totalPoints: number;
  dailyRate: number;
  recentPointsEarned: number;
  volumePoints?: number;
  liquidityPoints?: number;
  referralPoints?: number;
  isLoading?: boolean;
  // Referral stats
  totalReferees?: number;
  totalReferredTvlUsd?: number;
  totalReferredVolumeUsd?: number;
}

/**
 * Format position with # prefix
 */
function formatPosition(position: number | null): string {
  if (position === null || position <= 0) return "-";
  return `#${position.toLocaleString("en-US")}`;
}

/**
 * Format large numbers compactly
 */
function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * PointsStatsPanel - Dynamic stats panel that changes based on selected tab
 *
 * When History tab is active:
 * - Shows history-related stats (recent earnings, streaks, etc.)
 *
 * When Leaderboard tab is active:
 * - Shows leaderboard stats (rank, percentile, etc.)
 */
export const PointsStatsPanel = memo(function PointsStatsPanel({
  activeTab,
  leaderboardPosition,
  totalParticipants,
  totalPoints,
  dailyRate,
  recentPointsEarned,
  volumePoints = 0,
  liquidityPoints = 0,
  referralPoints = 0,
  isLoading = false,
  totalReferees = 0,
  totalReferredTvlUsd = 0,
  totalReferredVolumeUsd = 0,
}: PointsStatsPanelProps) {
  const isMobile = useIsMobile();

  // Calculate percentile if we have position and total
  const percentile = useMemo(() => {
    if (!leaderboardPosition || !totalParticipants || totalParticipants === 0) {
      return null;
    }
    const pct = ((totalParticipants - leaderboardPosition + 1) / totalParticipants) * 100;
    return Math.min(99.9, Math.max(0.1, pct)).toFixed(1);
  }, [leaderboardPosition, totalParticipants]);

  const renderContent = () => {
    if (activeTab === "leaderboard") {
      return (
        <LeaderboardStatsPanel
          leaderboardPosition={leaderboardPosition}
          totalParticipants={totalParticipants}
          percentile={percentile}
          totalPoints={totalPoints}
          isLoading={isLoading}
          isMobile={isMobile}
        />
      );
    }

    if (activeTab === "referral") {
      return (
        <ReferralStatsPanel
          referralPoints={referralPoints}
          totalReferees={totalReferees}
          totalReferredTvlUsd={totalReferredTvlUsd}
          totalReferredVolumeUsd={totalReferredVolumeUsd}
          isLoading={isLoading}
          isMobile={isMobile}
        />
      );
    }

    return (
      <HistoryStatsPanel
        dailyRate={dailyRate}
        recentPointsEarned={recentPointsEarned}
        totalPoints={totalPoints}
        volumePoints={volumePoints}
        liquidityPoints={liquidityPoints}
        referralPoints={referralPoints}
        isLoading={isLoading}
        isMobile={isMobile}
      />
    );
  };

  return (
    <div className="h-full overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={FADE_TRANSITION}
          className="h-full"
        >
          {renderContent()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
});

/**
 * History Stats Panel - Shows when History tab is active
 */
function HistoryStatsPanel({
  dailyRate,
  recentPointsEarned,
  totalPoints,
  volumePoints,
  liquidityPoints,
  referralPoints,
  isLoading,
  isMobile,
}: {
  dailyRate: number;
  recentPointsEarned: number;
  totalPoints: number;
  volumePoints: number;
  liquidityPoints: number;
  referralPoints: number;
  isLoading?: boolean;
  isMobile: boolean;
}) {
  const router = useRouter();
  const [isCtaHovered, setIsCtaHovered] = useState(false);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Points by Source Section */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground px-1">Points by Source</span>
        <div
          className={cn(
            "border border-sidebar-border rounded-lg",
            "overflow-hidden",
            "w-full"
          )}
          style={{
            background: "linear-gradient(135deg, #131314 0%, #18181a 100%)",
          }}
        >
          <div className="flex flex-col">
            {/* Volume Points */}
            <SourceRow
              icon={<VolumeIcon className="w-4 h-4 text-muted-foreground" />}
              label="Volume"
              value={formatCompact(volumePoints)}
              isLoading={isLoading}
            />

            {/* Divider */}
            <div className="h-px bg-sidebar-border" />

            {/* Liquidity Points */}
            <SourceRow
              icon={<LiquidityIcon className="w-4 h-4 text-muted-foreground" />}
              label="Liquidity"
              value={formatCompact(liquidityPoints)}
              isLoading={isLoading}
            />

            {/* Divider */}
            <div className="h-px bg-sidebar-border" />

            {/* Referral Points */}
            <SourceRow
              icon={<ReferralIcon className="w-4 h-4 text-muted-foreground" />}
              label="Referral"
              value={formatCompact(referralPoints)}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>

      {/* Activity Stats Pill - Stretches to fill remaining space */}
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-xs text-muted-foreground px-1">Points Earned</span>
        <div
          className={cn(
            "border border-sidebar-border rounded-lg",
            "overflow-hidden",
            "w-full flex-1 flex flex-col"
          )}
          style={{
            background: "linear-gradient(135deg, #131314 0%, #18181a 100%)",
          }}
        >
          <div className="flex flex-row flex-1">
            {/* Left Cell: Last 7 Days */}
            <div className="border-r border-sidebar-border px-3 py-2 w-1/2 flex flex-col justify-center">
              <div className="text-xs text-muted-foreground">Last 7 Days</div>
              <div
                className={cn(
                  "text-sm font-medium text-foreground mt-0.5",
                  isLoading && "animate-pulse"
                )}
                style={{ fontFamily: "Consolas, monospace" }}
              >
                {isLoading ? (
                  <span className="inline-block bg-muted/60 rounded h-4 w-14" />
                ) : (
                  formatCompact(recentPointsEarned)
                )}
              </div>
            </div>

            {/* Right Cell: Daily Average with Tooltip */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="px-3 py-2 w-1/2 cursor-default flex flex-col justify-center">
                    <div className="text-xs text-muted-foreground">Daily Avg</div>
                    <div
                      className={cn(
                        "text-sm font-medium text-foreground mt-0.5",
                        isLoading && "animate-pulse"
                      )}
                      style={{ fontFamily: "Consolas, monospace" }}
                    >
                      {isLoading ? (
                        <span className="inline-block bg-muted/60 rounded h-4 w-10" />
                      ) : (
                        dailyRate.toFixed(2)
                      )}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px]">
                  <p className="text-xs">Historical average, not a prediction of future earnings</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Interactive CTA Card */}
      <div
        className={cn(
          "bg-muted/20 border border-sidebar-border/40 rounded-lg",
          "px-4 py-2.5 cursor-pointer",
          "transition-all duration-150",
          isCtaHovered && "bg-muted/30"
        )}
        onMouseEnter={() => setIsCtaHovered(true)}
        onMouseLeave={() => setIsCtaHovered(false)}
        onClick={() => router.push("/liquidity")}
      >
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            Use Unified Pools to earn points
          </span>
          <IconChevronRight
            className={cn(
              "w-3 h-3 text-muted-foreground",
              "transition-transform duration-100",
              isCtaHovered && "translate-x-0.5"
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * SourceRow - Row for Points by Source section (with icons)
 */
function SourceRow({
  icon,
  label,
  value,
  isLoading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  isLoading?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-2.5",
        "flex items-center justify-between",
        "transition-all duration-200",
        "hover:bg-muted/40"
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {isLoading ? (
          <div className="h-4 w-12 bg-muted/40 rounded animate-pulse" />
        ) : (
          <span
            className="text-sm font-medium text-foreground"
            style={{ fontFamily: "Consolas, monospace" }}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Leaderboard Stats Panel - Shows when Leaderboard tab is active
 */
function LeaderboardStatsPanel({
  leaderboardPosition,
  totalParticipants,
  percentile,
  totalPoints,
  isLoading,
  isMobile,
}: {
  leaderboardPosition: number | null;
  totalParticipants: number;
  percentile: string | null;
  totalPoints: number;
  isLoading?: boolean;
  isMobile: boolean;
}) {
  return (
    <div className="h-full flex flex-col gap-3">
      {/* Your Ranking Section */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground px-1">Your Ranking</span>
        <div
          className={cn(
            "border border-sidebar-border rounded-lg",
            "overflow-hidden",
            "w-full"
          )}
          style={{
            background: "linear-gradient(135deg, #131314 0%, #18181a 100%)",
          }}
        >
          <div className="flex flex-col">
            {/* Your Rank */}
            <StatRow
              icon={<RankIcon className="w-4 h-4 text-muted-foreground" />}
              label="Your Rank"
              value={formatPosition(leaderboardPosition)}
              isLoading={isLoading}
              isMobile={isMobile}
            />

            {/* Divider */}
            <div className="h-px bg-sidebar-border" />

            {/* Total Users */}
            <StatRow
              icon={<UsersIcon className="w-4 h-4 text-muted-foreground" />}
              label="Total Users"
              value={formatCompact(totalParticipants)}
              isLoading={isLoading}
              isMobile={isMobile}
            />

            {/* Divider */}
            <div className="h-px bg-sidebar-border" />

            {/* Percentile */}
            <StatRow
              icon={<PercentileIcon className="w-4 h-4 text-muted-foreground" />}
              label="Percentile"
              value={percentile ? `${percentile}%` : "-"}
              isLoading={isLoading}
              isMobile={isMobile}
            />
          </div>
        </div>
      </div>

      {/* Spacer to push info card to bottom */}
      <div className="flex-1" />

      {/* Info Card */}
      <div
        className={cn(
          "bg-muted/20 border border-sidebar-border/40 rounded-lg",
          "px-4 py-3"
        )}
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          Rankings update every Thursday as Points are distributed.{" "}
          <Link href="/liquidity" className="underline hover:text-foreground transition-colors">
            Provide more liquidity
          </Link>{" "}
          to climb the leaderboard.
        </p>
      </div>
    </div>
  );
}

/**
 * Format USD value compactly
 */
function formatUsdCompact(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Referral Stats Panel - Shows when Referral tab is active
 */
function ReferralStatsPanel({
  referralPoints,
  totalReferees,
  totalReferredTvlUsd,
  totalReferredVolumeUsd,
  isLoading,
  isMobile,
}: {
  referralPoints: number;
  totalReferees: number;
  totalReferredTvlUsd: number;
  totalReferredVolumeUsd: number;
  isLoading?: boolean;
  isMobile: boolean;
}) {
  return (
    <div className="h-full flex flex-col gap-3">
      {/* Your Earnings Section */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground px-1">Your Earnings</span>
        <div
          className={cn(
            "border border-sidebar-border rounded-lg",
            "overflow-hidden",
            "w-full"
          )}
          style={{
            background: "linear-gradient(135deg, #131314 0%, #18181a 100%)",
          }}
        >
          <div className="flex flex-col">
            {/* Points Earned */}
            <StatRow
              icon={<PointsIcon className="w-4 h-4 text-muted-foreground" />}
              label="Points Earned"
              value={formatCompact(referralPoints)}
              isLoading={isLoading}
              isMobile={isMobile}
            />

            {/* Divider */}
            <div className="h-px bg-sidebar-border" />

            {/* Total Referrals */}
            <StatRow
              icon={<UsersIcon className="w-4 h-4 text-muted-foreground" />}
              label="Total Referrals"
              value={formatCompact(totalReferees)}
              isLoading={isLoading}
              isMobile={isMobile}
            />
          </div>
        </div>
      </div>

      {/* Referred Stats Pill - Stretches to fill remaining space */}
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-xs text-muted-foreground px-1">Referred</span>
        <div
          className={cn(
            "border border-sidebar-border rounded-lg",
            "overflow-hidden",
            "w-full flex-1 flex flex-col"
          )}
          style={{
            background: "linear-gradient(135deg, #131314 0%, #18181a 100%)",
          }}
        >
          <div className="flex flex-row flex-1">
            {/* Left Cell: TVL */}
            <div className="border-r border-sidebar-border px-3 py-2 w-1/2 flex flex-col justify-center">
              <div className="text-xs text-muted-foreground">TVL</div>
              <div
                className={cn(
                  "text-sm font-medium text-foreground mt-0.5",
                  isLoading && "animate-pulse"
                )}
                style={{ fontFamily: "Consolas, monospace" }}
              >
                {isLoading ? (
                  <span className="inline-block bg-muted/60 rounded h-4 w-14" />
                ) : (
                  formatUsdCompact(totalReferredTvlUsd)
                )}
              </div>
            </div>

            {/* Right Cell: Volume */}
            <div className="px-3 py-2 w-1/2 flex flex-col justify-center">
              <div className="text-xs text-muted-foreground">Volume</div>
              <div
                className={cn(
                  "text-sm font-medium text-foreground mt-0.5",
                  isLoading && "animate-pulse"
                )}
                style={{ fontFamily: "Consolas, monospace" }}
              >
                {isLoading ? (
                  <span className="inline-block bg-muted/60 rounded h-4 w-14" />
                ) : (
                  formatUsdCompact(totalReferredVolumeUsd)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <div
        className={cn(
          "bg-muted/20 border border-sidebar-border/40 rounded-lg",
          "px-4 py-3"
        )}
      >
        <p className="text-xs text-muted-foreground leading-relaxed">
          Refer friends to Alphix and <span style={{ color: '#ffffff' }}>earn 10% of their points</span>.
          Share your unique referral code to get started.
        </p>
      </div>
    </div>
  );
}

/**
 * StatRow - Individual stat display row
 * Includes warm hover state (Proposal 4)
 */
function StatRow({
  icon,
  label,
  value,
  suffix,
  isLoading,
  isMobile,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  isLoading?: boolean;
  isMobile: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-2.5",
        "flex items-center justify-between",
        "transition-all duration-200",
        "hover:bg-muted/40"
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {isLoading ? (
          <div className="h-5 w-16 bg-muted/40 rounded animate-pulse" />
        ) : (
          <>
            <span
              className={cn(
                "font-medium",
                isMobile ? "text-sm" : "text-base",
                "text-foreground"
              )}
              style={{ fontFamily: "Consolas, monospace" }}
            >
              {value}
            </span>
            {suffix && (
              <span className="text-sm text-muted-foreground/60">{suffix}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default PointsStatsPanel;
