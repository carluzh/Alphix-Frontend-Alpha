/**
 * PointsFeeStatTooltip
 *
 * Displays breakdown of Pool APR + Points APR = Total APR in a tooltip.
 * Mirrors Uniswap's LPIncentiveFeeStatTooltip from:
 * - interface/apps/web/src/components/Liquidity/LPIncentives/LPIncentiveFeeStatTooltip.tsx
 *
 * IMPORTANT: Backend logic is IDENTICAL to Uniswap's implementation.
 */

"use client"

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { POINTS_CAMPAIGN_ICON } from './constants';
import { formatPercent, PLACEHOLDER_TEXT } from './formatters';

// =============================================================================
// TYPES
// Mirrors LPIncentiveFeeStatTooltipProps from Uniswap
// =============================================================================

interface PointsFeeStatTooltipProps {
  /** Token0 symbol (for pair display) */
  token0Symbol?: string;
  /** Token1 symbol (for pair display) */
  token1Symbol?: string;
  /** Total APR (pool + points) */
  totalApr?: number;
  /** Pool APR from trading fees */
  poolApr?: number;
  /** Points campaign APR bonus */
  pointsApr?: number;
}

// =============================================================================
// SUB-COMPONENTS
// Mirrors TooltipRow and TooltipLabel from Uniswap
// =============================================================================

interface TooltipRowProps {
  children: React.ReactNode;
  /** Background color class (for highlighted rows) */
  className?: string;
  /** Whether this is the last row (for border radius) */
  isLast?: boolean;
}

/**
 * Tooltip row container.
 * Mirrors Uniswap's TooltipRow component.
 *
 * Layout: Flex row, justify-between, min-height $spacing24, gap $spacing8, px $spacing8
 */
function TooltipRow({ children, className, isLast }: TooltipRowProps) {
  return (
    <div
      className={cn(
        // Mirrors: Flex row justifyContent="space-between" alignItems px="$spacing8" minHeight="$spacing24" gap="$spacing8"
        "flex items-center justify-between px-2 min-h-6 gap-2",
        isLast && "rounded-b-md",
        className
      )}
    >
      {children}
    </div>
  );
}

interface TooltipLabelProps {
  /** Label text */
  label: string;
  /** Icon element */
  icon?: React.ReactNode;
  /** Text color class */
  colorClass?: string;
}

/**
 * Tooltip label with icon.
 * Mirrors Uniswap's TooltipLabel component.
 *
 * Layout: Flex row, gap $spacing6, flex 1, max-width 80%
 */
function TooltipLabel({ icon, label, colorClass = 'text-muted-foreground' }: TooltipLabelProps) {
  return (
    <div className="flex items-center gap-1.5 flex-1 max-w-[80%]">
      {/* Icon container - mirrors pt="$spacing2" flexShrink={0} */}
      {icon && (
        <div className="pt-0.5 flex-shrink-0">
          {icon}
        </div>
      )}
      {/* Label text - mirrors Text variant="body4" color={color} */}
      <span className={cn("text-xs flex-1", colorClass)}>
        {label}
      </span>
    </div>
  );
}

// =============================================================================
// PAIR LOGO COMPONENT
// Mirrors SplitLogo from Uniswap
// =============================================================================

interface PairLogoProps {
  token0Symbol?: string;
  token1Symbol?: string;
}

/**
 * Simplified pair logo display.
 * Mirrors Uniswap's SplitLogo component.
 */
function PairLogo({ token0Symbol, token1Symbol }: PairLogoProps) {
  if (!token0Symbol || !token1Symbol) {
    return <div className="w-3 h-3 rounded-full bg-muted" />;
  }

  return (
    <div className="flex items-center">
      <span className="text-[10px] text-muted-foreground">
        {token0Symbol}/{token1Symbol}
      </span>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Points fee stat tooltip component.
 * Displays breakdown of Pool APR, Points APR, and Total APR.
 *
 * Mirrors Uniswap's LPIncentiveFeeStatTooltip:
 * - Three rows: Pool APR, Reward APR, Total APR
 * - Total APR row highlighted with $accent2 background
 * - Uses formatPercent for all APR values
 *
 * @example
 * ```tsx
 * <PointsFeeStatTooltip
 *   token0Symbol="USDC"
 *   token1Symbol="WETH"
 *   poolApr={5.2}
 *   pointsApr={12.5}
 *   totalApr={17.7}
 * />
 * ```
 */
export function PointsFeeStatTooltip({
  token0Symbol,
  token1Symbol,
  poolApr,
  pointsApr,
  totalApr,
}: PointsFeeStatTooltipProps) {
  // Format APR values - mirrors Uniswap's formatPercent usage
  const displayPoolApr = poolApr !== undefined ? formatPercent(poolApr) : PLACEHOLDER_TEXT;
  const displayPointsApr = pointsApr !== undefined ? formatPercent(pointsApr) : PLACEHOLDER_TEXT;
  const displayTotalApr = totalApr !== undefined ? formatPercent(totalApr) : PLACEHOLDER_TEXT;

  return (
    <div
      // Mirrors: Flex flexDirection="column" gap="$spacing4" paddingTop="$spacing8" paddingBottom={5} px="$spacing4" maxWidth={256}
      className="flex flex-col gap-1 pt-2 pb-1 px-1 max-w-[256px]"
      id="points-apr-tooltip"
    >
      {/* Pool APR Row - mirrors first TooltipRow */}
      <TooltipRow>
        <TooltipLabel
          icon={<PairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
          label="Pool APR"
        />
        {/* Mirrors: Text variant="body4" color="$neutral1" flexShrink={0} */}
        <span className="text-xs text-foreground flex-shrink-0">
          {displayPoolApr}
        </span>
      </TooltipRow>

      {/* Points APR Row - mirrors second TooltipRow */}
      <TooltipRow>
        <TooltipLabel
          icon={
            <Image
              src={POINTS_CAMPAIGN_ICON}
              alt="Points"
              width={12}
              height={12}
              className="rounded-full"
            />
          }
          label="Points APR"
        />
        <span className="text-xs text-foreground flex-shrink-0">
          {displayPointsApr}
        </span>
      </TooltipRow>

      {/* Total APR Row - mirrors third TooltipRow with $accent2 background */}
      <TooltipRow
        // Mirrors: backgroundColor="$accent2" borderBottomLeftRadius="$rounded6" borderBottomRightRadius="$rounded6"
        className="bg-primary/10"
        isLast
      >
        <TooltipLabel
          icon={
            // Mirrors: Magic size="$icon.12" color="$accent1"
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className="text-primary"
            >
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="currentColor"
              />
            </svg>
          }
          label="Total APR"
          colorClass="text-primary"
        />
        {/* Mirrors: Text variant="body4" color="$accent1" */}
        <span className="text-xs text-primary flex-shrink-0">
          {displayTotalApr}
        </span>
      </TooltipRow>
    </div>
  );
}
