"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevronRight } from "nucleo-micro-bold-essential";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { PointsIcon } from "@/components/PointsIcons";

interface PointsRewardsCardProps {
  totalPoints?: number;
  isLoading?: boolean;
}

export function PointsRewardsCard({
  totalPoints = 0,
  isLoading = false,
}: PointsRewardsCardProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [isCtaHovered, setIsCtaHovered] = useState(false);

  const formattedPoints = useMemo(() => {
    return totalPoints.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }, [totalPoints]);

  const renderRewardsAmount = () => {
    if (isLoading) {
      return (
        <div
          className={cn(
            "rounded bg-muted/60 animate-pulse",
            isMobile ? "h-5 w-12" : "h-9 w-24"
          )}
        />
      );
    }

    return (
      <span
        className={cn(
          "font-semibold text-white",
          isMobile ? "text-lg" : "text-3xl"
        )}
      >
        {formattedPoints}
      </span>
    );
  };

  return (
    <div
      className="group cursor-pointer"
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
      onClick={() => router.push("/points")}
    >
      <div
        className={cn(
          isMobile ? "h-[142px]" : "h-[192px]",
          isMobile ? "p-4" : "p-6",
          "flex flex-col justify-between",
          "bg-muted/30 border border-sidebar-border/60 rounded-lg",
          "overflow-hidden relative",
          "transition-all duration-300 ease-out",
          isCardHovered && "bg-muted/40 border-sidebar-primary/30"
        )}
      >
        {/* Background Pattern - fades on hover */}
        <div
          className={cn(
            "absolute inset-0",
            "bg-center bg-repeat",
            "transition-opacity duration-200 ease-out",
            isCardHovered ? "opacity-40" : "opacity-60"
          )}
          style={{
            backgroundImage: "url(/patterns/button-default.svg)",
            backgroundSize: "auto",
          }}
        />

        {/* Animated Points Icons in background */}
        <AnimatedPointsIcons isMobile={isMobile} />

        {/* Top Section: Amount + Logo with Dot */}
        <div className="relative flex flex-row justify-between">
          <div className="w-full flex flex-col gap-0.5">
            {/* Row: Amount | Logo with Dot */}
            <div className="flex flex-row justify-between items-center">
              {/* Amount */}
              {renderRewardsAmount()}

              {/* Points Icon - white in top right */}
              <PointsIcon
                className={cn(
                  "text-white",
                  isMobile ? "w-6 h-6" : "w-7 h-7"
                )}
              />
            </div>

            {/* Subtitle: Points earned */}
            <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
              Points earned
            </span>
          </div>
        </div>

        {/* Bottom Section: CTA + Description - clickable area */}
        <div
          className={cn(
            "relative flex flex-col gap-0.5 -m-2 p-2 rounded-md cursor-pointer",
            "transition-all duration-150",
            isCtaHovered && "bg-muted/40"
          )}
          onMouseEnter={() => { setIsCtaHovered(true); setIsCardHovered(false); }}
          onMouseLeave={() => { setIsCtaHovered(false); setIsCardHovered(true); }}
          onClick={(e) => { e.stopPropagation(); router.push("/liquidity"); }}
        >
          <div className="flex flex-row items-center gap-1.5">
            <span className={cn("text-foreground", isMobile ? "text-xs" : "text-sm")}>
              {totalPoints > 0 ? "Earn more points" : "Start earning points"}
            </span>
            <IconChevronRight
              className={cn(
                "transition-transform duration-100",
                isMobile ? "h-3 w-3" : "h-4 w-4",
                isCtaHovered && "translate-x-1"
              )}
            />
          </div>
          <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
            Provide liquidity in Unified Pools to earn points
          </span>
        </div>

      </div>
    </div>
  );
}

// Animated Points Icons component - similar to AnimatedEmblems
function AnimatedPointsIcons({ isMobile }: { isMobile: boolean }) {
  const animationDuration = '300ms'
  const size = isMobile ? 65 : 75

  return (
    <>
      <style>
        {`
          @keyframes pointsIconEnterBottomRight {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(-30deg);
            }
            to {
              opacity: 0.15;
              transform: scale(1) rotate(8deg);
            }
          }
        `}
      </style>

      {/* Single icon - bottom right */}
      <div className={cn(
        "absolute z-[1]",
        isMobile ? "bottom-0 right-2" : "bottom-0 right-4"
      )}>
        <div
          style={{
            animationName: 'pointsIconEnterBottomRight',
            animationDuration: animationDuration,
            animationDelay: '50ms',
            animationTimingFunction: 'ease-out',
            animationFillMode: 'forwards',
            opacity: 0,
          }}
        >
          <PointsIcon
            className="text-white"
            width={size}
            height={size}
          />
        </div>
      </div>
    </>
  )
}

export default PointsRewardsCard;
