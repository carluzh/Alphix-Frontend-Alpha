"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PageLoadingFallbackProps {
  variant?: "default" | "liquidity" | "portfolio" | "settings" | "pool-detail";
  className?: string;
}

/**
 * Loading fallback component for lazy-loaded pages.
 * Provides skeleton UI matching each page's layout for smooth loading transitions.
 */
export function PageLoadingFallback({
  variant = "default",
  className
}: PageLoadingFallbackProps) {
  return (
    <div className={cn("flex flex-1 flex-col", className)}>
      <div className="flex flex-1 flex-col p-3 sm:p-6 overflow-x-hidden">
        {variant === "liquidity" && <LiquidityPageSkeleton />}
        {variant === "portfolio" && <PortfolioPageSkeleton />}
        {variant === "settings" && <SettingsPageSkeleton />}
        {variant === "pool-detail" && <PoolDetailPageSkeleton />}
        {variant === "default" && <DefaultPageSkeleton />}
      </div>
    </div>
  );
}

function DefaultPageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

function LiquidityPageSkeleton() {
  return (
    <>
      {/* Header Section */}
      <div className="mb-2">
        <div className="flex items-stretch gap-4">
          <div className="flex flex-col flex-1 min-w-0">
            <Skeleton className="h-7 w-40 mb-2" />
            <Skeleton className="h-4 w-72" />

            {/* Stats Card */}
            <div className="mt-4">
              <div className="w-full max-w-[860px] 2xl:max-w-[920px] rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2 md:p-4">
                <div className="grid w-full grid-cols-2 sm:grid-cols-3 gap-1.5 md:gap-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="min-w-0 rounded-lg bg-muted/30 border border-sidebar-border/60 p-3 md:p-4">
                      <Skeleton className="h-3 w-16 mb-2" />
                      <Skeleton className="h-6 w-24" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="w-full overflow-x-auto isolate mt-4">
        <div className="w-full bg-muted/30 border border-sidebar-border/60 rounded-lg overflow-hidden">
          {/* Table Header */}
          <div className="flex items-center gap-4 p-4 border-b border-sidebar-border/60">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16 ml-auto" />
          </div>

          {/* Table Rows */}
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-b border-sidebar-border/30 last:border-b-0">
              <div className="flex items-center gap-2">
                <div className="flex">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <Skeleton className="h-7 w-7 rounded-full -ml-2" />
                </div>
                <div>
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-16 rounded-md ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PortfolioPageSkeleton() {
  return (
    <>
      {/* Header Stats */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="h-8 w-40" />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-16 mt-1" />
            </div>
          ))}
        </div>
      </div>

      {/* Positions Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>

        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-sidebar-border bg-muted/30 overflow-hidden">
            {/* Position Header */}
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-6 w-6 rounded-full -ml-2" />
                </div>
                <div>
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-9 w-[200px] hidden lg:block" />
            </div>

            {/* Position Stats */}
            <div className="flex items-center gap-5 py-1.5 px-4 bg-muted/30">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="flex flex-col gap-0.5 flex-1">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SettingsPageSkeleton() {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-xl space-y-8">
        {/* Network Section */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-20" />
          <div className="rounded-lg border border-sidebar-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-5 rounded" />
            </div>
          </div>
        </div>

        {/* Trading Section */}
        <div className="space-y-3">
          <Skeleton className="h-5 w-16" />
          <div className="rounded-lg border border-sidebar-border/60 bg-muted/30 divide-y divide-sidebar-border/60">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PoolDetailPageSkeleton() {
  return (
    <>
      {/* Back Button and Header */}
      <div className="mb-4">
        <Skeleton className="h-8 w-24 mb-4" />
        <div className="flex items-center gap-3">
          <div className="flex">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full -ml-2" />
          </div>
          <div>
            <Skeleton className="h-6 w-32 mb-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>

      {/* Pool Stats */}
      <div className="rounded-lg border border-sidebar-border/60 bg-muted/30 p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Add Liquidity Form Skeleton */}
      <div className="rounded-lg border border-sidebar-border/60 bg-muted/30 p-4">
        <Skeleton className="h-5 w-32 mb-4" />

        {/* Token Inputs */}
        <div className="space-y-3">
          <div className="rounded-lg border border-sidebar-border/60 p-4">
            <div className="flex justify-between mb-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
          </div>

          <div className="rounded-lg border border-sidebar-border/60 p-4">
            <div className="flex justify-between mb-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
          </div>
        </div>

        {/* Price Range */}
        <div className="mt-4">
          <Skeleton className="h-5 w-24 mb-3" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>

        {/* Submit Button */}
        <Skeleton className="h-12 w-full mt-4 rounded-lg" />
      </div>

      {/* Positions Section */}
      <div className="mt-6">
        <Skeleton className="h-5 w-32 mb-3" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-sidebar-border bg-muted/30 overflow-hidden">
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <Skeleton className="h-6 w-6 rounded-full -ml-2" />
                  </div>
                  <div>
                    <Skeleton className="h-4 w-24 mb-1" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-5 py-1.5 px-4 bg-muted/30">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="flex flex-col gap-0.5 flex-1">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
