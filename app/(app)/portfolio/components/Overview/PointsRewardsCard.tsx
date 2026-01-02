"use client";

/**
 * PointsRewardsCard - Copied from interface/apps/web/src/components/Liquidity/LPIncentives/LpIncentiveRewardsCard.tsx
 * Converted from Tamagui to Tailwind CSS
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [isHovered, setIsHovered] = useState(false);

  const formattedPoints = useMemo(() => {
    return totalPoints.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }, [totalPoints]);

  const renderRewardsAmount = () => {
    if (isLoading) {
      return (
        <div
          className={cn(
            "rounded bg-muted/40 animate-pulse",
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
      className="group cursor-default max-w-[600px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main Container - matches Uniswap: height 192px desktop, 142px mobile */}
      <div
        className={cn(
          // Height
          isMobile ? "h-[142px]" : "h-[192px]",
          // Padding: $spacing16 mobile, $spacing24 desktop
          isMobile ? "p-4" : "p-6",
          // Layout
          "flex flex-col justify-between",
          // Styling - $surface2 bg, $surface3 border, $rounded20
          "bg-muted/30 border border-sidebar-border/60 rounded-[20px]",
          "overflow-hidden relative",
          // Transition + shadow on hover
          "transition-all duration-200 ease-out",
          isHovered && "shadow-lg"
        )}
      >
        {/* Background Pattern */}
        <div
          className={cn(
            "absolute inset-0",
            "bg-center bg-repeat",
            "transition-transform duration-200 ease-out",
            "opacity-20",
            isHovered && "scale-[1.2]"
          )}
          style={{
            backgroundImage: "url(/pattern_wide.svg)",
            backgroundSize: "auto",
          }}
        />

        {/* Top Section: Amount + Logo with Dot */}
        <div className="relative flex flex-row justify-between">
          <div className="w-full flex flex-col gap-0.5">
            {/* Row: Amount | Logo with Dot */}
            <div className="flex flex-row justify-between items-center">
              {/* Amount */}
              {renderRewardsAmount()}

              {/* Logo Token with Pulsating Dot */}
              <div className="relative">
                {/* White circle background with logo */}
                <div
                  className={cn(
                    "rounded-full bg-white flex items-center justify-center",
                    isMobile ? "w-6 h-6" : "w-7 h-7"
                  )}
                >
                  <Image
                    src="/LogoIconBlack.svg"
                    alt="Alphix"
                    width={isMobile ? 18 : 22}
                    height={isMobile ? 18 : 22}
                    className="object-contain"
                  />
                </div>

                {/* Pulsating Live Dot - positioned bottom right of logo */}
                <div
                  className={cn(
                    "absolute flex items-center justify-center",
                    isMobile ? "-bottom-0.5 -right-0.5" : "-bottom-0.5 -right-0.5"
                  )}
                >
                  {/* Outer pulsing rings */}
                  <div
                    className="absolute w-2 h-2 rounded-full bg-green-500"
                    style={{
                      animation: "livePulse 2s ease-in-out infinite",
                    }}
                  />
                  <div
                    className="absolute w-2 h-2 rounded-full bg-green-500"
                    style={{
                      animation: "livePulse 2s ease-in-out infinite 0.5s",
                    }}
                  />
                  {/* Inner solid dot */}
                  <div className="w-2 h-2 rounded-full bg-green-500 border border-background" />
                </div>
              </div>
            </div>

            {/* Subtitle: Points earned + Info Tooltip */}
            <div className={cn("flex flex-row items-center", isMobile ? "gap-1.5" : "gap-1.5")}>
              <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
                Points earned
              </span>
              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <button className="inline-flex items-center justify-center">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="text-muted-foreground/60"
                      >
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
                        <path
                          d="M8 7V11"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <circle cx="8" cy="5" r="0.75" fill="currentColor" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[240px] bg-popover border border-sidebar-border p-3"
                  >
                    <p className="text-sm text-foreground">
                      Points are earned by providing liquidity and swapping on Alphix Unified Pools.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Bottom Section: CTA + Description */}
        <div className="relative flex flex-col gap-0.5">
          {/* Find pools link */}
          <button
            onClick={() => router.push("/liquidity")}
            className="flex flex-row items-center gap-1.5 self-start group/link hover:opacity-80 transition-opacity"
          >
            <span className={cn("text-foreground", isMobile ? "text-xs" : "text-sm")}>
              {totalPoints > 0 ? "Earn more points" : "Start earning points"}
            </span>
            <ArrowRight
              className={cn(
                "transition-transform duration-100",
                isMobile ? "h-3 w-3" : "h-4 w-4",
                "group-hover/link:translate-x-1"
              )}
            />
          </button>

          {/* Description */}
          <span className={cn("text-muted-foreground", isMobile ? "text-xs" : "text-sm")}>
            Provide liquidity or swap on Alphix Unified Pools to earn points
          </span>
        </div>

        {/* Keyframes for pulsating dot */}
        <style>
          {`
            @keyframes livePulse {
              0% {
                transform: scale(1);
                opacity: 0.5;
              }
              75% {
                transform: scale(3);
                opacity: 0;
              }
              100% {
                transform: scale(3);
                opacity: 0;
              }
            }
          `}
        </style>
      </div>
    </div>
  );
}

export default PointsRewardsCard;
