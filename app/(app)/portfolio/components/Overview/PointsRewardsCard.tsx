"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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
      className="group cursor-pointer"
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div
        className={cn(
          isMobile ? "h-[142px]" : "h-[192px]",
          isMobile ? "p-4" : "p-6",
          "flex flex-col justify-between",
          "bg-muted/30 border border-sidebar-border/60 rounded-lg",
          "overflow-hidden relative",
          "transition-all duration-200 ease-out",
          isCardHovered && "bg-muted/40 border-sidebar-border/80"
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
            backgroundImage: "url(/pattern.svg)",
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
                    "-bottom-0.5 -right-0.5"
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
          onClick={() => router.push("/liquidity")}
        >
          <div className="flex flex-row items-center gap-1.5">
            <span className={cn("text-foreground", isMobile ? "text-xs" : "text-sm")}>
              {totalPoints > 0 ? "Earn more points" : "Start earning points"}
            </span>
            <ArrowRight
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
