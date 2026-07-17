/**
 * Liquidity position status constants + helpers.
 *
 * Despite the filename, this module exports primitives (StatusIndicatorCircle,
 * lpStatusConfig, FULL_RANGE_CONFIG, label/color helpers) — there is no
 * `LiquidityPositionStatusIndicator` component. Cards compose the primitives
 * themselves (see PositionCardCompact, UnifiedYieldPositionCard).
 *
 * Filename retained to match Uniswap's source:
 * - interface/apps/web/src/components/Liquidity/LiquidityPositionStatusIndicator.tsx
 * - interface/apps/web/src/components/Liquidity/constants.ts (lpStatusConfig)
 */

"use client"

import React from 'react';
import type { PositionStatus } from '@/types';

// =============================================================================
// STATUS CONFIGURATION
// Mirrors Uniswap's lpStatusConfig from components/Liquidity/constants.ts
// =============================================================================

/**
 * Status configuration mapping.
 * Maps each PositionStatus to display properties.
 *
 * Color mapping to Tailwind classes:
 * - $statusSuccess → text-green-500 (In Range)
 * - $statusCritical → text-red-500 (Out of Range)
 * - $neutral2 → text-muted-foreground (Closed)
 */
const lpStatusConfig: Record<PositionStatus, {
  label: string;
  color: string;
} | undefined> = {
  'IN_RANGE': {
    label: 'In Range',
    color: 'text-green-500',
  },
  'OUT_OF_RANGE': {
    label: 'Out of Range',
    color: 'text-red-500',
  },
  'CLOSED': {
    label: 'Closed',
    color: 'text-muted-foreground',
  },
};

/**
 * Special configuration for Full Range positions.
 * Full Range is a display variant of IN_RANGE, not a separate status.
 */
const FULL_RANGE_CONFIG = {
  label: 'Full Range',
  color: 'text-green-500',
} as const;

// =============================================================================
// STATUS INDICATOR CIRCLE
// Mirrors Uniswap's StatusIndicatorCircle from ui/src/components/icons
// =============================================================================

interface StatusIndicatorCircleProps {
  className?: string;
}

/**
 * Status indicator circle SVG.
 * Two concentric circles: outer at 40% opacity, inner solid.
 * Color is inherited via currentColor.
 */
export function StatusIndicatorCircle({ className }: StatusIndicatorCircleProps) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="none"
      className={className}
    >
      {/* Outer circle - 40% opacity */}
      <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4" />
      {/* Inner circle - solid */}
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get the display label for a position status.
 * Mirrors Uniswap's getProtocolStatusLabel from utils/protocolVersion.ts
 *
 * @param status - Position status
 * @param isFullRange - Whether this is a full-range position
 * @returns Display label string
 */
export function getPositionStatusLabel(
  status: PositionStatus,
  isFullRange: boolean = false
): string {
  if (isFullRange && status === 'IN_RANGE') {
    return FULL_RANGE_CONFIG.label;
  }

  const config = lpStatusConfig[status];
  return config?.label ?? '';
}

/**
 * Get the color class for a position status.
 *
 * @param status - Position status
 * @param isFullRange - Whether this is a full-range position
 * @returns Tailwind color class
 */
export function getPositionStatusColor(
  status: PositionStatus,
  isFullRange: boolean = false
): string {
  if (isFullRange && status === 'IN_RANGE') {
    return FULL_RANGE_CONFIG.color;
  }

  const config = lpStatusConfig[status];
  return config?.color ?? 'text-muted-foreground';
}
