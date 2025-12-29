/**
 * PointsTooltip
 *
 * Tooltip wrapper component for points campaign displays.
 * Mirrors Uniswap's MouseoverTooltip from:
 * - interface/apps/web/src/components/Tooltip.tsx
 *
 * Uses Radix UI Tooltip primitives (available via shadcn/ui) for accessibility.
 */

"use client"

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES
// Mirrors TooltipSize enum from Uniswap
// =============================================================================

/**
 * Tooltip size presets.
 * Mirrors Uniswap's TooltipSize enum.
 */
export enum TooltipSize {
  ExtraSmall = '200px',
  Small = '256px',
  Large = '400px',
  Max = 'max-content',
}

interface PointsTooltipProps {
  /** Tooltip content */
  content: React.ReactNode;
  /** Trigger element */
  children: React.ReactNode;
  /** Tooltip size (default: Small) */
  size?: TooltipSize;
  /** Whether tooltip is disabled */
  disabled?: boolean;
  /** Custom padding in pixels (overrides default) */
  padding?: number;
  /** Placement of tooltip */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional CSS classes for content */
  className?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// Mirrors getPaddingForSize from Uniswap
// =============================================================================

/**
 * Get padding value for tooltip size.
 * Mirrors Uniswap's getPaddingForSize function.
 */
function getPaddingForSize(size: TooltipSize): string {
  switch (size) {
    case TooltipSize.ExtraSmall:
    case TooltipSize.Max:
      return '8px';
    case TooltipSize.Small:
      return '12px';
    case TooltipSize.Large:
      return '16px 20px';
    default:
      return '12px';
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Points tooltip wrapper component.
 * Provides hover-triggered tooltip with customizable content.
 *
 * Mirrors Uniswap's MouseoverTooltip:
 * - Size-based styling system
 * - Optional padding override
 * - Disabled state support
 * - Uses Radix UI primitives for accessibility
 *
 * @example
 * ```tsx
 * <PointsTooltip
 *   content={<PointsFeeStatTooltip poolApr={5} pointsApr={12} totalApr={17} />}
 *   size={TooltipSize.Small}
 *   padding={0}
 * >
 *   <span>Hover me</span>
 * </PointsTooltip>
 * ```
 */
export function PointsTooltip({
  content,
  children,
  size = TooltipSize.Small,
  disabled = false,
  padding,
  placement = 'top',
  className,
}: PointsTooltipProps) {
  // If disabled, render children without wrapper - mirrors Uniswap's Fragment return
  if (disabled) {
    return <>{children}</>;
  }

  // Calculate padding style
  const paddingStyle = padding !== undefined
    ? `${padding}px`
    : getPaddingForSize(size);

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-pointer">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={placement}
          className={cn(
            // Mirrors Uniswap's TooltipContainer styled component
            "bg-popover border border-sidebar-border rounded-xl shadow-lg",
            "text-xs font-medium text-foreground",
            className
          )}
          style={{
            maxWidth: size,
            width: size === TooltipSize.Max ? 'auto' : `calc(100vw - 16px)`,
            padding: paddingStyle,
          }}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
