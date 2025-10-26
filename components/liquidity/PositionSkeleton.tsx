"use client"

/**
 * Position Skeleton - Matches PositionCardCompact design
 *
 * Two-section layout:
 * - Top: Token info (icons + pair + status)
 * - Bottom: Position/Fees/APY/Range metrics
 */

import React from 'react';
import { cn } from "@/lib/utils";

interface PositionSkeletonProps {
  token0Symbol?: string;
  token1Symbol?: string;
  className?: string;
}

export function PositionSkeleton({ token0Symbol, token1Symbol, className = "" }: PositionSkeletonProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border border-sidebar-border bg-muted/30 overflow-hidden",
        className
      )}
    >
      <style>{`
        .skeleton-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>

      {/* TOP SECTION - Token Info */}
      <div className="relative flex items-center justify-between gap-4 p-4">
        {/* Left: Token Images + Token Info */}
        <div className="flex items-center gap-3 min-w-0 flex-shrink">
          {/* Token Stack Skeleton */}
          <div className="flex items-center flex-shrink-0 mr-2">
            <div className="relative" style={{ width: 40, height: 24 }}>
              <div className="absolute rounded-full bg-muted/60 skeleton-pulse" style={{ width: 24, height: 24, left: 0, top: 0 }} />
              <div className="absolute rounded-full bg-muted/50 skeleton-pulse" style={{ width: 24, height: 24, left: 12, top: 0 }} />
            </div>
          </div>

          <div className="flex flex-col justify-center gap-0.5 min-w-0">
            {/* Token Pair Skeleton */}
            <div className="h-4 w-24 bg-muted/60 rounded skeleton-pulse" />
            {/* Status Badge Skeleton */}
            <div className="flex items-center gap-2">
              <div className="h-3 w-16 bg-muted/50 rounded skeleton-pulse" />
            </div>
          </div>
        </div>

        {/* Right: Mini Chart Skeleton - hidden on mobile, shown on desktop */}
        <div className="hidden lg:flex flex-1 max-w-[200px] h-9 ml-auto">
          <div className="w-full h-full bg-muted/40 rounded skeleton-pulse" />
        </div>
      </div>

      {/* BOTTOM SECTION - Position, Fees, APR, Range */}
      <div className="flex items-center justify-between gap-5 py-1.5 px-4 rounded-b-lg bg-muted/30">
        {/* Position Skeleton */}
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="h-4 w-16 bg-muted/60 rounded skeleton-pulse mb-0.5" />
          <div className="text-[10px] text-muted-foreground">Position</div>
        </div>

        {/* Fees Skeleton */}
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="h-4 w-14 bg-muted/60 rounded skeleton-pulse mb-0.5" />
          <div className="text-[10px] text-muted-foreground">Fees</div>
        </div>

        {/* APY Skeleton */}
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="h-4 w-12 bg-muted/60 rounded skeleton-pulse" />
          <div className="text-[10px] text-muted-foreground">APY</div>
        </div>

        {/* Range Skeleton - Hidden on mobile, shown on desktop */}
        <div className="hidden lg:flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="h-4 w-24 bg-muted/60 rounded skeleton-pulse" />
          <div className="text-[10px] text-muted-foreground">Range</div>
        </div>
      </div>
    </div>
  );
}
