"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { SeasonIcon } from "@/components/PointsIcons";

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
  } = useMemo(() => {
    const now = new Date();
    const seasonEnd = new Date(seasonStartDate);
    seasonEnd.setDate(seasonEnd.getDate() + seasonDurationDays);

    const totalMs = seasonDurationDays * ONE_DAY_MS;
    const elapsedMs = Math.max(0, now.getTime() - seasonStartDate.getTime());
    const seasonProg = Math.min(100, (elapsedMs / totalMs) * 100);

    // Calculate current week (1-indexed)
    const elapsedDays = elapsedMs / ONE_DAY_MS;
    const week = Math.floor(elapsedDays / 7) + 1;
    const weeks = Math.ceil(seasonDurationDays / 7);

    // Week progress (0-100% within current week)
    const msIntoWeek = elapsedMs % (7 * ONE_DAY_MS);
    const weekProg = (msIntoWeek / (7 * ONE_DAY_MS)) * 100;

    // Time remaining calculations
    const seasonRemMs = Math.max(0, seasonEnd.getTime() - now.getTime());
    const weekRemMs = Math.max(0, (7 * ONE_DAY_MS) - msIntoWeek);

    // Season is active if we're between start and end
    const isActive = now >= seasonStartDate && now <= seasonEnd;

    return {
      seasonProgress: seasonProg,
      currentWeek: Math.min(week, weeks),
      totalWeeks: weeks,
      weekProgress: weekProg,
      seasonRemainingMs: seasonRemMs,
      weekRemainingMs: weekRemMs,
      isSeasonActive: isActive,
    };
  }, [seasonStartDate, seasonDurationDays]);

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
          backgroundImage: "url(/pattern.svg)",
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
          <div className="text-xs text-muted-foreground">
            <span className="text-sidebar-primary font-bold">{formatPoints(pointsPerWeek)}</span> pts/week
          </div>
        </div>

        {/* Progress bars with muted backdrop */}
        <div className="-mx-5 -mb-5 px-5 pb-5 pt-3 bg-black/10 rounded-b-lg flex flex-col gap-4">
          {/* Season Progress Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Season Progress</span>
              <span className="text-foreground font-medium" style={{ fontFamily: "Consolas, monospace" }}>
                {formatSeasonRemaining(seasonRemainingMs)}
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
                {formatWeekRemaining(weekRemainingMs)}
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
