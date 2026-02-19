"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { PointsIcon } from "@/components/PointsIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PointsInventoryCardProps {
  totalPoints: number;
  dailyRate: number;
  recentPointsEarned?: number;
  leaderboardPosition?: number | null;
  isLoading?: boolean;
}

/**
 * Format points with 2 decimal places
 */
function formatPoints(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format daily rate with appropriate suffix
 */
function formatDailyRate(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format compact number
 */
function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Format leaderboard position
 */
function formatPosition(position: number | null | undefined): string {
  if (position === null || position === undefined || position <= 0) return "-";
  return `#${position.toLocaleString("en-US")}`;
}

/**
 * PointsInventoryCard - Hero card showing user's points balance
 *
 * Large card (280-320px height) with:
 * - Current point balance (large, prominent)
 * - Daily earning rate (/d)
 * - Pattern background with animated points icons
 * - Hover effects
 */
export const PointsInventoryCard = memo(function PointsInventoryCard({
  totalPoints,
  dailyRate,
  recentPointsEarned = 0,
  leaderboardPosition,
  isLoading = false,
}: PointsInventoryCardProps) {
  const isMobile = useIsMobile();

  const formattedPoints = useMemo(() => formatPoints(totalPoints), [totalPoints]);
  const formattedDailyRate = useMemo(() => formatDailyRate(dailyRate), [dailyRate]);
  const formattedRecent = useMemo(() => formatCompact(recentPointsEarned), [recentPointsEarned]);
  const formattedPosition = useMemo(() => formatPosition(leaderboardPosition), [leaderboardPosition]);

  const renderBalance = () => {
    if (isLoading) {
      return (
        <div
          className={cn(
            "rounded bg-muted/40 animate-pulse",
            isMobile ? "h-10 w-32" : "h-14 w-48"
          )}
        />
      );
    }

    return (
      <span
        className={cn(
          "font-bold text-white tracking-tight",
          isMobile ? "text-4xl" : "text-5xl"
        )}
      >
        {formattedPoints}
      </span>
    );
  };

  return (
    <div className="group">
      <div
        className={cn(
          // Height - hero style (larger than PointsRewardsCard)
          isMobile ? "h-[240px]" : "h-[300px]",
          // Padding
          isMobile ? "p-5" : "p-8",
          // Layout
          "flex flex-col justify-between",
          // Background and border
          "bg-muted/30 border border-sidebar-border/60 rounded-lg",
          // Overflow for pattern
          "overflow-hidden relative",
          // Hover transitions
          "transition-all duration-200 ease-out",
          "group-hover:bg-muted/40 group-hover:border-white/20"
        )}
      >
        {/* Background Pattern - fades on hover */}
        <div
          className={cn(
            "absolute inset-0",
            "bg-center bg-repeat",
            "transition-opacity duration-200 ease-out",
            "opacity-60 group-hover:opacity-40"
          )}
          style={{
            backgroundImage: "url(/patterns/button-default.svg)",
            backgroundSize: "auto",
          }}
        />

        {/* Animated Points Icons in background */}
        <AnimatedPointsIcons isMobile={isMobile} />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full justify-between">
          {/* Top: Points Icon Badge + Label */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center justify-center rounded-lg",
                "bg-white/10 backdrop-blur-sm",
                isMobile ? "w-8 h-8" : "w-10 h-10"
              )}
            >
              <PointsIcon
                className={cn("text-white", isMobile ? "w-5 h-5" : "w-6 h-6")}
              />
            </div>
            <span
              className={cn(
                "font-medium text-white/80",
                isMobile ? "text-sm" : "text-base"
              )}
            >
              Points Balance
            </span>
          </div>

          {/* Center: Main Balance */}
          <div className="flex flex-col gap-2">
            {renderBalance()}
            <span
              className={cn(
                "text-muted-foreground",
                isMobile ? "text-xs" : "text-sm"
              )}
            >
              Total points earned
            </span>
          </div>

          {/* Bottom: Stats Row */}
          <div className="flex flex-col gap-2">
            {/* Stats Pill */}
            <div
              className={cn(
                "flex flex-row rounded-lg overflow-hidden",
                "bg-white/5 backdrop-blur-sm",
                "border border-white/10"
              )}
            >
              {/* Daily Rate with Tooltip */}
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-1 px-3 py-2 border-r border-white/10 cursor-default">
                      <div className={cn("text-xs text-muted-foreground/70", isMobile && "text-[10px]")}>
                        Daily
                      </div>
                      {isLoading ? (
                        <div className="h-4 w-10 bg-muted/40 rounded animate-pulse mt-0.5" />
                      ) : (
                        <div className={cn("text-sm font-medium text-white/90", isMobile && "text-xs")}>
                          {formattedDailyRate}
                        </div>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p className="text-xs">Historical average, not a prediction of future earnings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* 7 Day */}
              <div className="flex-1 px-3 py-2 border-r border-white/10">
                <div className={cn("text-xs text-muted-foreground/70", isMobile && "text-[10px]")}>
                  7 Day
                </div>
                {isLoading ? (
                  <div className="h-4 w-10 bg-muted/40 rounded animate-pulse mt-0.5" />
                ) : (
                  <div className={cn("text-sm font-medium text-white/90", isMobile && "text-xs")}>
                    {formattedRecent}
                  </div>
                )}
              </div>

              {/* Rank */}
              <div className="flex-1 px-3 py-2">
                <div className={cn("text-xs text-muted-foreground/70", isMobile && "text-[10px]")}>
                  Rank
                </div>
                {isLoading ? (
                  <div className="h-4 w-10 bg-muted/40 rounded animate-pulse mt-0.5" />
                ) : (
                  <div className={cn("text-sm font-medium text-white/90", isMobile && "text-xs")}>
                    {formattedPosition}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * AnimatedPointsIcons - Decorative animated icons in background
 */
function AnimatedPointsIcons({ isMobile }: { isMobile: boolean }) {
  const animationDuration = "400ms";
  const sizes = isMobile ? [50, 60, 45] : [70, 80, 55];

  return (
    <>
      <style>
        {`
          @keyframes pointsIconFloat1 {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(20deg) translateY(10px);
            }
            to {
              opacity: 0.12;
              transform: scale(1) rotate(-8deg) translateY(0);
            }
          }
          @keyframes pointsIconFloat2 {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(-10deg) translateY(8px);
            }
            to {
              opacity: 0.10;
              transform: scale(1) rotate(12deg) translateY(0);
            }
          }
          @keyframes pointsIconFloat3 {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(15deg) translateY(10px);
            }
            to {
              opacity: 0.08;
              transform: scale(1) rotate(-5deg) translateY(0);
            }
          }
        `}
      </style>

      {/* First icon - top right */}
      <div
        className={cn(
          "absolute z-[1]",
          isMobile ? "-top-2 right-4" : "-top-4 right-8"
        )}
      >
        <div
          style={{
            animationName: "pointsIconFloat1",
            animationDuration: animationDuration,
            animationDelay: "0ms",
            animationTimingFunction: "ease-out",
            animationFillMode: "forwards",
            opacity: 0,
          }}
        >
          <PointsIcon
            className="text-white"
            width={sizes[0]}
            height={sizes[0]}
          />
        </div>
      </div>

      {/* Third icon - between first and second, further left */}
      <div
        className={cn(
          "absolute z-[1]",
          isMobile ? "top-[30%] right-32" : "top-[28%] right-[30%]"
        )}
      >
        <div
          style={{
            animationName: "pointsIconFloat2",
            animationDuration: animationDuration,
            animationDelay: "50ms",
            animationTimingFunction: "ease-out",
            animationFillMode: "forwards",
            opacity: 0,
          }}
        >
          <PointsIcon
            className="text-white"
            width={sizes[2]}
            height={sizes[2]}
          />
        </div>
      </div>

      {/* Second icon - center right */}
      <div
        className={cn(
          "absolute z-[1]",
          isMobile ? "top-1/2 right-8" : "top-1/2 right-16"
        )}
      >
        <div
          style={{
            animationName: "pointsIconFloat3",
            animationDuration: animationDuration,
            animationDelay: "100ms",
            animationTimingFunction: "ease-out",
            animationFillMode: "forwards",
            opacity: 0,
          }}
        >
          <PointsIcon
            className="text-white"
            width={sizes[1]}
            height={sizes[1]}
          />
        </div>
      </div>
    </>
  );
}

export default PointsInventoryCard;
