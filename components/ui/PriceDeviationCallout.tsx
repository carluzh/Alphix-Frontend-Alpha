'use client';

/**
 * Price Deviation Callout Component
 *
 * Two display modes:
 * - inline: Simple icon + text, no background (for use alongside other warnings)
 * - card: Full callout with background, icon container, title + description
 *
 * Severity colors (dark mode):
 * - Low (0.1-5%): #FFBF17 (amber)
 * - Medium (5-10%): #FFBF17 (amber)
 * - High (10%+): #FF593C (red)
 */

import { cn } from '@/lib/utils';
import { IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';
import type { DeviationSeverity, PriceDeviationResult } from '@/hooks/usePriceDeviation';

interface PriceDeviationCalloutProps {
  /** Price deviation data from usePriceDeviation hook */
  deviation: PriceDeviationResult;
  /** Token0 symbol for display */
  token0Symbol: string;
  /** Token1 symbol for display */
  token1Symbol: string;
  /** Additional CSS classes */
  className?: string;
  /** Display mode: 'inline' (no bg, icon+text only), 'card' (compact), or 'large' (prominent callout) */
  variant?: 'inline' | 'card' | 'large';
  /** External loading state (e.g., quote is loading) - shows skeleton */
  isQuoteLoading?: boolean;
}

// Color values for severity levels
const SEVERITY_COLORS = {
  low: '#FFBF17',      // Amber
  medium: '#FFBF17',   // Amber
  high: '#FF593C',     // Red
} as const;


export function PriceDeviationCallout({
  deviation,
  token0Symbol,
  token1Symbol,
  className,
  variant = 'card',
  isQuoteLoading = false,
}: PriceDeviationCalloutProps) {
  // Don't render if no deviation or severity is 'none'
  if (deviation.severity === 'none' || deviation.absoluteDeviation === null) {
    return null;
  }

  // Show skeleton if market prices are loading OR quote is loading (pool price is stale)
  const isLoading = deviation.isLoading || isQuoteLoading;
  const percentStr = deviation.absoluteDeviation.toFixed(1);
  const directionWord = deviation.direction === 'above' ? 'more' : 'less';
  const color = SEVERITY_COLORS[deviation.severity];
  const isHigh = deviation.severity === 'high';

  // Inline format: "{value}% less/more than market price"
  const inlineMessage = `${percentStr}% ${directionWord} than market price`;

  // Inline variant: simple icon + text, no background
  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-row items-center gap-1', className)}>
        <IconTriangleWarningFilled
          className="w-4 h-4 shrink-0"
          style={{ color }}
        />
        {isLoading ? (
          <div className="h-4 w-32 rounded animate-pulse bg-muted" />
        ) : (
          <span className="text-sm" style={{ color }}>
            {inlineMessage}
          </span>
        )}
      </div>
    );
  }

  // Shared colors for card variants
  const bgColor = isHigh ? 'rgba(255, 89, 60, 0.08)' : 'rgba(255, 191, 23, 0.08)';
  const borderColor = isHigh ? 'rgba(255, 89, 60, 0.2)' : 'rgba(255, 191, 23, 0.2)';
  const borderHoverColor = isHigh ? 'rgba(255, 89, 60, 0.4)' : 'rgba(255, 191, 23, 0.4)';
  const iconBgColor = isHigh ? 'rgba(255, 89, 60, 0.12)' : 'rgba(255, 191, 23, 0.12)';

  // Large variant: prominent callout with larger icon and text
  if (variant === 'large') {
    // Severity label for large variant
    const severityLabel = isHigh ? 'High Price Deviation' : 'Price Deviation';
    const largeMessage = `${severityLabel}: ${percentStr}% ${directionWord} than market price`;

    return (
      <div
        className={cn(
          'flex flex-row items-center gap-3 rounded-lg border p-3 transition-colors',
          className
        )}
        style={{
          backgroundColor: bgColor,
          borderColor: borderColor,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = borderHoverColor; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; }}
      >
        {/* Icon with background container - larger */}
        <div
          className="flex items-center justify-center p-2 rounded-md shrink-0"
          style={{ backgroundColor: iconBgColor }}
        >
          <IconTriangleWarningFilled
            className="w-5 h-5"
            style={{ color }}
          />
        </div>

        {/* Message with skeleton when loading - larger text */}
        {isLoading ? (
          <div className="h-5 w-56 rounded animate-pulse" style={{ backgroundColor: iconBgColor }} />
        ) : (
          <span className="text-sm font-medium" style={{ color }}>
            {largeMessage}
          </span>
        )}
      </div>
    );
  }

  // Card variant (default): compact callout with background
  return (
    <div
      className={cn(
        'flex flex-row items-center gap-2 rounded-lg border p-2 transition-colors',
        className
      )}
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = borderHoverColor; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; }}
    >
      {/* Icon with background container */}
      <div
        className="flex items-center justify-center p-1.5 rounded-md shrink-0"
        style={{ backgroundColor: iconBgColor }}
      >
        <IconTriangleWarningFilled
          className="w-3.5 h-3.5"
          style={{ color }}
        />
      </div>

      {/* Message with skeleton when loading */}
      {isLoading ? (
        <div className="h-4 w-32 rounded animate-pulse" style={{ backgroundColor: iconBgColor }} />
      ) : (
        <span className="text-xs font-medium" style={{ color }}>
          {inlineMessage}
        </span>
      )}
    </div>
  );
}

export default PriceDeviationCallout;
