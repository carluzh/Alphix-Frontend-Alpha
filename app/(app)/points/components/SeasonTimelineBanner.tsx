"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SeasonIcon } from "@/components/PointsIcons";
import { IconCircleInfo } from "nucleo-micro-bold-essential";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Time constants (inspired by Uniswap's utilities/src/time/time.ts)
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface SeasonTimelineBannerProps {
  /** Season start date */
  seasonStartDate: Date;
  /** Season duration in days (default 90 days / 3 months) */
  seasonDurationDays?: number;
  /** Points distributed per week */
  pointsPerWeek?: number;
  isLoading?: boolean;
  /**
   * TEMPORARY OVERRIDE: Offset in days from seasonStartDate for when Week 1 actually starts.
   * Use this for launch week adjustments. Set to 1 if W1 starts 1 day after season start.
   * Remove after first week is complete.
   */
  firstWeekOffsetDays?: number;
  /**
   * TEMPORARY OVERRIDE: Duration in days for the first week only.
   * Use this if the first week is shorter/longer than 7 days.
   * Remove after first week is complete.
   */
  firstWeekDurationDays?: number;
}

/**
 * Format season time remaining - shows months + days
 * Output: "2mo 12d" or "0mo 5d"
 */
function formatSeasonRemaining(ms: number): string {
  const totalDays = Math.floor(ms / ONE_DAY_MS);
  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;
  return `${months}mo ${days}d`;
}

/**
 * Format week time remaining - shows days+hours, or hours+minutes in last hour
 * Output: "1d 21h" or "5h 30m" or "45m 20s"
 */
function formatWeekRemaining(ms: number): string {
  if (ms < ONE_HOUR_MS) {
    // Last hour: show minutes and seconds
    const minutes = Math.floor(ms / ONE_MINUTE_MS);
    const seconds = Math.floor((ms % ONE_MINUTE_MS) / 1000);
    return `${minutes}m ${seconds}s`;
  } else if (ms < ONE_DAY_MS) {
    // Less than a day: show hours and minutes
    const hours = Math.floor(ms / ONE_HOUR_MS);
    const minutes = Math.floor((ms % ONE_HOUR_MS) / ONE_MINUTE_MS);
    return `${hours}h ${minutes}m`;
  } else {
    // Days: show days and hours
    const days = Math.floor(ms / ONE_DAY_MS);
    const hours = Math.floor((ms % ONE_DAY_MS) / ONE_HOUR_MS);
    return `${days}d ${hours}h`;
  }
}

/**
 * SeasonTimelineBanner - Shows Season 0 progress and current week indicator
 */
export const SeasonTimelineBanner = memo(function SeasonTimelineBanner({
  seasonStartDate,
  seasonDurationDays = 90,
  pointsPerWeek = 100000,
  isLoading,
  // TEMPORARY: Week 1 overrides - remove after W1 ends
  firstWeekOffsetDays = 0,
  firstWeekDurationDays,
}: SeasonTimelineBannerProps) {
  // Calculate progress values
  const {
    seasonProgress,
    currentWeek,
    totalWeeks,
    weekProgress,
    seasonRemainingMs,
    weekRemainingMs,
    isSeasonActive,
    isBeforeSeason,
    msUntilStart,
  } = useMemo(() => {
    const now = new Date();

    // =======================================================================
    // TEMPORARY LAUNCH OVERRIDE - Remove after W1 ends (Thursday Feb 20, 2026)
    // Override backend's season start to Feb 13 19:00 CET (18:00 UTC) for display
    // =======================================================================
    const LAUNCH_OVERRIDE_START = new Date("2026-02-13T18:00:00Z");
    const effectiveSeasonStart = LAUNCH_OVERRIDE_START;
    // After removing override, change back to: const effectiveSeasonStart = seasonStartDate;
    // =======================================================================

    const seasonEnd = new Date(effectiveSeasonStart);
    seasonEnd.setDate(seasonEnd.getDate() + seasonDurationDays);

    // Week 1 starts with offset from effective season start
    const week1Start = new Date(effectiveSeasonStart);
    week1Start.setDate(week1Start.getDate() + firstWeekOffsetDays);
    const week1Duration = firstWeekDurationDays ?? 7;

    // Check if we're before Week 1 start (for week display purposes)
    const beforeWeek1 = now < week1Start;
    const msUntilWeek1 = week1Start.getTime() - now.getTime();
    const daysUntilWeek1 = Math.ceil(msUntilWeek1 / ONE_DAY_MS);

    // Season progress uses effective season start
    const beforeSeason = now < effectiveSeasonStart;
    const totalMs = seasonDurationDays * ONE_DAY_MS;
    const elapsedMs = Math.max(0, now.getTime() - effectiveSeasonStart.getTime());
    const seasonProg = beforeSeason ? 0 : Math.min(100, (elapsedMs / totalMs) * 100);

    // Calculate current week with W1 override
    // W1 ends at week1Start + week1Duration, then normal 7-day weeks
    const week1EndMs = week1Start.getTime() + (week1Duration * ONE_DAY_MS);
    const msFromWeek1Start = now.getTime() - week1Start.getTime();

    let week: number;
    let weekProg: number;
    let weekRemMs: number;

    if (beforeWeek1) {
      // Before Week 1 starts
      week = 0;
      weekProg = 0;
      weekRemMs = 0;
    } else if (now.getTime() < week1EndMs) {
      // During Week 1 (uses custom duration)
      week = 1;
      weekProg = (msFromWeek1Start / (week1Duration * ONE_DAY_MS)) * 100;
      weekRemMs = Math.max(0, week1EndMs - now.getTime());
    } else {
      // After Week 1: normal 7-day weeks
      const msAfterWeek1 = now.getTime() - week1EndMs;
      const weeksAfterW1 = Math.floor(msAfterWeek1 / (7 * ONE_DAY_MS));
      week = 2 + weeksAfterW1;
      const msIntoCurrentWeek = msAfterWeek1 % (7 * ONE_DAY_MS);
      weekProg = (msIntoCurrentWeek / (7 * ONE_DAY_MS)) * 100;
      weekRemMs = Math.max(0, (7 * ONE_DAY_MS) - msIntoCurrentWeek);
    }

    // Total weeks calculation (W1 may be shorter, rest are 7 days)
    const daysAfterW1 = seasonDurationDays - firstWeekOffsetDays - week1Duration;
    const weeksAfterW1 = Math.ceil(daysAfterW1 / 7);
    const weeks = 1 + weeksAfterW1;

    // Time remaining calculations
    const seasonRemMs = Math.max(0, seasonEnd.getTime() - now.getTime());

    // Season is active if we're between start and end
    const isActive = now >= effectiveSeasonStart && now <= seasonEnd;

    return {
      seasonProgress: seasonProg,
      currentWeek: Math.min(week, weeks),
      totalWeeks: weeks,
      weekProgress: weekProg,
      seasonRemainingMs: seasonRemMs,
      weekRemainingMs: weekRemMs,
      isSeasonActive: isActive,
      isBeforeSeason: beforeWeek1, // Use week1 for "before" display
      msUntilStart: msUntilWeek1, // Raw ms for proper formatting
    };
  }, [seasonStartDate, seasonDurationDays, firstWeekOffsetDays, firstWeekDurationDays]);

  const formatPoints = (points: number) => {
    return new Intl.NumberFormat("en-US").format(points);
  };

  if (isLoading) {
    return (
      <div className="bg-muted/30 border border-sidebar-border/60 rounded-lg h-[160px] animate-pulse" />
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        "bg-muted/30 border border-sidebar-border/60 rounded-lg",
        "p-5"
      )}
    >
      {/* Subtle orange gradient glow - top right corner */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 50% 50% at 90% 10%, rgba(244, 85, 2, 0.06) 0%, transparent 70%)",
        }}
      />

      {/* Pattern overlay */}
      <div
        className="absolute inset-0 bg-center bg-repeat opacity-40 pointer-events-none"
        style={{
          backgroundImage: "url(/patterns/button-default.svg)",
          backgroundSize: "auto",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Pulsing live indicator (exact copy of Uniswap's LiveDotRenderer) */}
            {isSeasonActive && <PulsingLiveDot />}
            <span className="text-sm font-semibold text-foreground">Season</span>
            <div
              className={cn(
                "flex items-center justify-center rounded-lg",
                "bg-white/10 backdrop-blur-sm",
                "w-6 h-6"
              )}
            >
              <SeasonIcon className="w-3 h-3 text-white/70" />
            </div>
          </div>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-xs text-muted-foreground flex items-center gap-1 cursor-default">
                  <span className="text-sidebar-primary font-bold">{formatPoints(pointsPerWeek)}</span> pts/week
                  <IconCircleInfo className="w-3 h-3 text-muted-foreground/60" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px]">
                <p className="text-xs">Distributed every Thursday at 02:00 UTC</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Progress bars with muted backdrop */}
        <div className="-mx-5 -mb-5 px-5 pb-5 pt-3 bg-black/10 rounded-b-lg flex flex-col gap-4">
          {/* Season Progress Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Season Progress</span>
              <span className="text-foreground font-medium" style={{ fontFamily: "Consolas, monospace" }}>
                {isBeforeSeason ? (
                  <span className="text-sidebar-primary">starting in {formatWeekRemaining(msUntilStart)}</span>
                ) : (
                  formatSeasonRemaining(seasonRemainingMs)
                )}
              </span>
            </div>
            <SeasonProgressBar progress={seasonProgress} />
          </div>

          {/* Week Progress Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Current Week{" "}
                <span className="text-foreground font-medium">S0W{currentWeek}</span>
              </span>
              <span className="text-foreground font-medium" style={{ fontFamily: "Consolas, monospace" }}>
                {isBeforeSeason ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatWeekRemaining(weekRemainingMs)
                )}
              </span>
            </div>
            <WeekProgressBar progress={weekProgress} />
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * PulsingLiveDot - Exact copy of Uniswap's LiveDotRenderer pattern
 * Green colored, with dual expanding rings that fade out
 */
function PulsingLiveDot() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 10, height: 10 }}>
      {/* Outer pulsing ring 1 */}
      <div
        className="absolute rounded-full animate-pulse-ring"
        style={{
          width: 10,
          height: 10,
          backgroundColor: "rgb(34, 197, 94)", // green-500
          opacity: 0.3,
        }}
      />
      {/* Outer pulsing ring 2 (staggered) */}
      <div
        className="absolute rounded-full animate-pulse-ring"
        style={{
          width: 10,
          height: 10,
          backgroundColor: "rgb(34, 197, 94)", // green-500
          opacity: 0.3,
          animationDelay: "0.5s",
        }}
      />
      {/* Inner solid dot */}
      <div
        className="absolute rounded-full border-2 border-background"
        style={{
          width: 10,
          height: 10,
          backgroundColor: "rgb(34, 197, 94)", // green-500
        }}
      />
    </div>
  );
}

/**
 * SeasonProgressBar - Progress bar with visible 100% track
 */
function SeasonProgressBar({ progress }: { progress: number }) {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="relative h-2 rounded-full bg-white/5">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-foreground/60 to-foreground/90 transition-all duration-500 ease-out"
        style={{
          width: `${clampedProgress}%`,
          minWidth: clampedProgress > 0 ? "4px" : "0",
        }}
      />
    </div>
  );
}

/**
 * WeekProgressBar - Progress bar with visible 100% track
 */
function WeekProgressBar({ progress }: { progress: number }) {
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="relative h-2 rounded-full bg-white/5">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clampedProgress}%`,
          minWidth: clampedProgress > 0 ? "4px" : "0",
          backgroundColor: "#404040",
        }}
      />
    </div>
  );
}

export default SeasonTimelineBanner;
