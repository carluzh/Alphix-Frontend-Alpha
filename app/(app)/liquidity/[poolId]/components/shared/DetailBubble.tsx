"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface DetailBubbleProps {
  height?: number;
  width?: number;
  className?: string;
}

/**
 * Loading skeleton bubble component.
 * Adapted from Uniswap's DetailBubble pattern.
 * @see interface/apps/web/src/components/Pools/PoolDetails/shared.ts
 */
export const DetailBubble = memo(function DetailBubble({
  height = 16,
  width = 80,
  className,
}: DetailBubbleProps) {
  return (
    <div
      className={cn(
        "rounded bg-muted/60 animate-pulse",
        className
      )}
      style={{
        height: `${height}px`,
        width: `${width}px`,
      }}
    />
  );
});

/**
 * Stat section skeleton - larger bubble for stat values
 */
export const StatSectionBubble = memo(function StatSectionBubble({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[180px] h-10 rounded-lg bg-muted/60 animate-pulse",
        className
      )}
    />
  );
});

/**
 * Stat header skeleton - for stat labels
 */
export const StatHeaderBubble = memo(function StatHeaderBubble({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[116px] h-6 rounded-lg bg-muted/60 animate-pulse",
        className
      )}
    />
  );
});
