"use client"

import React from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";

interface PositionSkeletonProps {
  token0Symbol?: string;
  token1Symbol?: string;
  className?: string;
}

export function PositionSkeleton({ token0Symbol, token1Symbol, className = "" }: PositionSkeletonProps) {
  
  return (
    <Card className={`bg-muted/30 border border-sidebar-border/60 ${className}`}>
      <style jsx>{`
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
      <div className="skeleton-pulse">
      <CardContent className="p-3 sm:p-4">
        <div
          className="grid sm:items-center"
          style={{
            gridTemplateColumns: 'min-content minmax(0, 1.7fr) minmax(0, 1.5fr) minmax(0, 1.5fr) 1fr min-content',
            columnGap: '1.25rem',
          }}
        >
          {/* Token Stack Skeleton */}
          <div className="flex items-center min-w-0 flex-none gap-0">
            <div className="relative" style={{ width: 40, height: 24 }}>
              <div className="absolute rounded-full bg-muted/50" style={{ width: 24, height: 24, left: 0, top: 0 }} />
              <div className="absolute rounded-full bg-muted/40" style={{ width: 24, height: 24, left: 12, top: 0 }} />
            </div>
          </div>

          {/* Token Amounts Skeleton */}
          <div className="flex flex-col min-w-0 items-start truncate pr-2 gap-1">
            <div className="h-3 w-24 bg-muted/40 rounded" />
            <div className="h-3 w-20 bg-muted/30 rounded" />
          </div>

          {/* Position Value Skeleton */}
          <div className="flex items-start pr-2">
            <div className="flex flex-col gap-1 items-start">
              <div className="h-3 w-16 bg-muted/40 rounded" />
              <div className="h-4 w-20 bg-muted/30 rounded" />
            </div>
          </div>

          {/* Fees Skeleton */}
          <div className="flex items-start pr-2">
            <div className="flex flex-col gap-1 items-start">
              <div className="h-3 w-10 bg-muted/40 rounded" />
              <div className="h-3 w-24 bg-muted/30 rounded" />
            </div>
          </div>

          <div />

          {/* Action Button Skeleton */}
          <div className="hidden sm:flex items-center justify-end gap-2 flex-none">
            <div className="h-7 w-20 bg-muted/30 rounded-md border border-sidebar-border/60" />
          </div>
        </div>
      </CardContent>

      {/* Footer Skeleton */}
      <CardFooter className="flex items-center justify-between py-1.5 px-3 bg-muted/10 border-t border-sidebar-border/30">
        <div className="flex items-center text-xs text-muted-foreground gap-3">
          <div className="h-3 w-32 bg-muted/40 rounded" />
          <div className="w-px h-3 bg-border"></div>
          <div className="h-3 w-8 bg-muted/40 rounded" />
        </div>
        
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-16 bg-muted/40 rounded-md" />
          <div className="h-5 w-5 bg-muted/30 rounded" />
        </div>
      </CardFooter>
      </div>
    </Card>
  );
}
