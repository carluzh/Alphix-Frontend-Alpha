/**
 * PointsFeeStatTooltip
 *
 * Displays breakdown of Pool APR + Points APR in a tooltip.
 * Shows token images for Pool APR row and backdrop for Points APR row.
 */

"use client"

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { POINTS_CAMPAIGN_ICON } from './constants';
import { formatPercent, PLACEHOLDER_TEXT } from './formatters';
import { getToken } from '@/lib/pools-config';

// =============================================================================
// TYPES
// =============================================================================

interface PointsFeeStatTooltipProps {
  /** Token0 symbol (for pair display) */
  token0Symbol?: string;
  /** Token1 symbol (for pair display) */
  token1Symbol?: string;
  /** Pool APR from trading fees */
  poolApr?: number;
  /** Points campaign APR bonus */
  pointsApr?: number;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface TooltipRowProps {
  children: React.ReactNode;
  /** Background color class (for highlighted rows) */
  className?: string;
}

/**
 * Tooltip row container.
 */
function TooltipRow({ children, className }: TooltipRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-2.5 py-1.5 gap-3",
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
 */
function TooltipLabel({ icon, label, colorClass = 'text-muted-foreground' }: TooltipLabelProps) {
  return (
    <div className="flex items-center gap-2 flex-1">
      {icon && (
        <div className="flex-shrink-0">
          {icon}
        </div>
      )}
      <span className={cn("text-xs", colorClass)}>
        {label}
      </span>
    </div>
  );
}

// =============================================================================
// TOKEN PAIR LOGO COMPONENT
// =============================================================================

interface TokenPairLogoProps {
  token0Symbol?: string;
  token1Symbol?: string;
}

/**
 * Displays overlapping token logos for the pair.
 */
function TokenPairLogo({ token0Symbol, token1Symbol }: TokenPairLogoProps) {
  const token0Config = token0Symbol ? getToken(token0Symbol) : null;
  const token1Config = token1Symbol ? getToken(token1Symbol) : null;

  const icon0 = (token0Config as any)?.icon;
  const icon1 = (token1Config as any)?.icon;

  return (
    <div className="flex items-center -space-x-1">
      {icon0 ? (
        <Image
          src={icon0}
          alt={token0Symbol || ''}
          width={14}
          height={14}
          className="rounded-full ring-1 ring-popover"
        />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
      )}
      {icon1 ? (
        <Image
          src={icon1}
          alt={token1Symbol || ''}
          width={14}
          height={14}
          className="rounded-full ring-1 ring-popover"
        />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full bg-muted ring-1 ring-popover" />
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Points fee stat tooltip component.
 * Displays breakdown of Pool APR and Points APR.
 *
 * Design:
 * - Pool APR row with token images
 * - Points APR row with backdrop highlight
 * - No Total APR row (already visible on base component)
 */
export function PointsFeeStatTooltip({
  token0Symbol,
  token1Symbol,
  poolApr,
  pointsApr,
}: PointsFeeStatTooltipProps) {
  // Format APR values
  const displayPoolApr = poolApr !== undefined ? formatPercent(poolApr) : PLACEHOLDER_TEXT;
  const displayPointsApr = pointsApr !== undefined ? formatPercent(pointsApr) : PLACEHOLDER_TEXT;

  return (
    <div
      className="flex flex-col py-1 min-w-[180px]"
      id="points-apr-tooltip"
    >
      {/* Pool APR Row - with token images */}
      <TooltipRow>
        <TooltipLabel
          icon={<TokenPairLogo token0Symbol={token0Symbol} token1Symbol={token1Symbol} />}
          label="Pool APR"
        />
        <span className="text-xs text-foreground flex-shrink-0 font-mono">
          {displayPoolApr}
        </span>
      </TooltipRow>

      {/* Points APR Row - with backdrop */}
      <TooltipRow className="bg-primary/10 rounded-lg mx-1 mt-1">
        <TooltipLabel
          icon={
            <Image
              src={POINTS_CAMPAIGN_ICON}
              alt="Points"
              width={14}
              height={14}
              className="rounded-full"
            />
          }
          label="Points APR"
          colorClass="text-primary"
        />
        <span className="text-xs text-primary flex-shrink-0 font-mono">
          {displayPointsApr}
        </span>
      </TooltipRow>
    </div>
  );
}
