"use client";

import React from "react";
import { PositionSkeleton } from "@/components/liquidity/PositionSkeleton";

/**
 * Skeleton components for the Portfolio page
 * Extracted from page.tsx for modularity
 */

export const SkeletonBlock = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded ${className}`} {...props} />
);

export const SkeletonLine = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded h-4 w-20 ${className}`} {...props} />
);

export const TokenPairLogoSkeleton = ({ size = 28, className = "" }: { size?: number; className?: string }) => (
  <div className={`rounded-full bg-muted/60 ${className}`} style={{ width: `${size}px`, height: `${size}px` }} />
);

/**
 * Portfolio Header Skeleton - matches the responsive 3/2/1 card layout
 */
export const PortfolioHeaderSkeleton = ({ viewportWidth = 1440 }: { viewportWidth?: number }) => {
  if (viewportWidth <= 1000) {
    // Mobile/Tablet collapsible header skeleton
    return (
      <div className="w-full max-w-full overflow-x-clip rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 animate-skeleton-pulse">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex-1 min-w-0 space-y-3">
            <SkeletonLine className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-full max-w-[180px]" />
            <SkeletonLine className="h-3 w-32" />
          </div>
          <div className="flex-none w-[120px] max-w-[42%] min-w-0 space-y-2">
            <div className="flex justify-between items-center pl-2"><SkeletonLine className="h-3 w-16" /><SkeletonLine className="h-3 w-8" /></div>
            <div className="flex justify-between items-center pl-2"><SkeletonLine className="h-3 w-12" /><SkeletonLine className="h-3 w-10" /></div>
            <div className="flex justify-between items-center pl-2"><SkeletonLine className="h-3 w-8" /><SkeletonLine className="h-3 w-12" /></div>
          </div>
          <div className="h-5 w-5 bg-muted/60 rounded-full" />
        </div>
      </div>
    );
  }

  const isThreeCard = viewportWidth > 1400;

  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: isThreeCard ? 'minmax(240px, max-content) minmax(240px, max-content) 1fr' : 'minmax(240px, max-content) 1fr' }}>
      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between animate-skeleton-pulse space-y-3">
        <SkeletonLine className="h-3 w-24" />
        <div>
          <SkeletonBlock className="h-10 w-40" />
          <SkeletonLine className="h-4 w-32 mt-2" />
        </div>
        <div />
      </div>
      {isThreeCard && (
        <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 py-1.5 px-4 h-full flex flex-col justify-center animate-skeleton-pulse">
          <div className="w-full divide-y divide-sidebar-border/40 space-y-2 py-2">
            <div className="flex justify-between items-center pt-1"><SkeletonLine className="h-3 w-16" /><SkeletonLine className="h-3 w-8" /></div>
            <div className="flex justify-between items-center pt-2"><SkeletonLine className="h-3 w-12" /><SkeletonLine className="h-3 w-10" /></div>
            <div className="flex justify-between items-center pt-2"><SkeletonLine className="h-3 w-8" /><SkeletonLine className="h-3 w-12" /></div>
          </div>
        </div>
      )}
      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between animate-skeleton-pulse space-y-3">
        <SkeletonLine className="h-3 w-32" />
        <div className="space-y-2">
          <SkeletonBlock className="h-2 w-full rounded-full" />
          <div className="flex justify-between">
            <SkeletonLine className="h-3 w-12" />
            <SkeletonLine className="h-3 w-10" />
            <SkeletonLine className="h-3 w-16" />
          </div>
        </div>
        <div />
      </div>
    </div>
  );
};

/**
 * Balances list skeleton - matches integrated balances list layout
 */
export const BalancesListSkeleton = () => (
  <div className="flex flex-col divide-y divide-sidebar-border/60">
    {[...Array(6)].map((_, idx) => (
      <div key={idx} className="flex items-center justify-between h-[64px] pl-6 pr-6">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-muted/60 flex-shrink-0" />
          <div className="flex flex-col min-w-0 gap-1">
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-3 w-24 opacity-80" />
          </div>
        </div>
        <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
          <SkeletonLine className="h-4 w-20" />
          <SkeletonLine className="h-3 w-14 opacity-80" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * Active positions skeleton
 */
export const ActivePositionsSkeleton = () => (
  <div className="flex flex-col gap-3 lg:gap-4">
    {[...Array(4)].map((_, idx) => (
      <PositionSkeleton key={idx} />
    ))}
  </div>
);

/**
 * Compact positions skeleton for narrow viewports
 */
export const CompactPositionsSkeleton = () => (
  <div className="flex flex-col gap-3">
    {[...Array(3)].map((_, idx) => (
      <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <TokenPairLogoSkeleton size={24} />
          <div className="flex-1 space-y-2 min-w-0">
            <SkeletonLine className="h-4 w-24 sm:w-32" />
            <SkeletonLine className="h-3 w-32 sm:w-40" />
          </div>
          <div className="text-right space-y-1">
            <SkeletonLine className="h-4 w-16" />
            <SkeletonLine className="h-3 w-12" />
          </div>
        </div>
      </div>
    ))}
  </div>
);
