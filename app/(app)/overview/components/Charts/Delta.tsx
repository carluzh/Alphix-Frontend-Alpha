"use client";

import { cn } from "@/lib/utils";

// Arrow icons
function ArrowChangeUp({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M13.3021 7.7547L17.6821 14.2475C18.4182 15.3388 17.7942 17 16.6482 17L7.3518 17C6.2058 17 5.5818 15.3376 6.3179 14.2475L10.6979 7.7547C11.377 6.7484 12.623 6.7484 13.3021 7.7547Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowChangeDown({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M10.6979 16.2453L6.31787 9.75247C5.58184 8.66118 6.2058 7 7.35185 7L16.6482 7C17.7942 7 18.4182 8.66243 17.6821 9.75247L13.3021 16.2453C12.623 17.2516 11.377 17.2516 10.6979 16.2453Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function calculateDelta(start: number, current: number): number | undefined {
  const delta = (current / start - 1) * 100;
  return isValidDelta(delta) ? delta : undefined;
}

function isValidDelta(delta: number | null | undefined): delta is number {
  // Null-check not including zero
  return delta !== null && delta !== undefined && delta !== Infinity && !isNaN(delta);
}

interface DeltaArrowProps {
  delta?: number | null;
  noColor?: boolean;
  size?: number;
}

export function DeltaArrow({
  delta,
  noColor = false,
  size = 14,
}: DeltaArrowProps) {
  if (!isValidDelta(delta)) {
    return null;
  }

  const isNegative = Math.sign(delta) < 0;
  const colorClass = noColor || delta === 0
    ? "text-muted-foreground"
    : isNegative
    ? "text-red-500"
    : "text-green-500";

  return isNegative ? (
    <ArrowChangeDown size={size} className={colorClass} aria-label="down" />
  ) : (
    <ArrowChangeUp size={size} className={colorClass} aria-label="up" />
  );
}

interface DeltaTextProps {
  delta?: number;
  children: React.ReactNode;
}

export function DeltaText({ delta, children }: DeltaTextProps) {
  const colorClass =
    delta === undefined || delta === 0
      ? "text-muted-foreground"
      : Math.sign(delta) < 0
      ? "text-red-500"
      : "text-green-500";

  return <span className={cn("text-sm", colorClass)}>{children}</span>;
}
