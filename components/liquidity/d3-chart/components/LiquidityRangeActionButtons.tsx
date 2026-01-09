'use client';

/**
 * Liquidity Range Action Buttons
 *
 * Time period selector, zoom buttons, and reset button for the D3 chart.
 * Copied from Uniswap's LiquidityRangeActionButtons pattern.
 *
 * @see interface/apps/web/src/components/Charts/D3LiquidityRangeInput/D3LiquidityRangeChart/components/LiquidityRangeActionButtons
 */

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { HistoryDuration } from '@/lib/chart/types';

// Time period options matching Uniswap's pattern
const TIME_PERIODS = [
  { value: HistoryDuration.DAY, label: '1D' },
  { value: HistoryDuration.WEEK, label: '1W' },
  { value: HistoryDuration.MONTH, label: '1M' },
  { value: HistoryDuration.YEAR, label: '1Y' },
] as const;

interface ZoomButtonsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterRange: () => void;
  isFullRange?: boolean;
}

/**
 * Zoom Buttons - copied from Uniswap's ZoomButtons.tsx
 */
function ZoomButtons({ onZoomIn, onZoomOut, onCenterRange, isFullRange }: ZoomButtonsProps) {
  return (
    <div className="flex rounded-full border border-sidebar-border">
      <button
        onClick={onZoomOut}
        className={cn(
          'p-2 rounded-l-full hover:bg-sidebar-accent transition-colors',
          'border-r border-sidebar-border'
        )}
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        onClick={onCenterRange}
        disabled={isFullRange}
        className={cn(
          'p-2 hover:bg-sidebar-accent transition-colors',
          'border-r border-sidebar-border',
          isFullRange && 'opacity-50 cursor-not-allowed'
        )}
        title="Center range"
      >
        <Maximize2 className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        onClick={onZoomIn}
        className="p-2 rounded-r-full hover:bg-sidebar-accent transition-colors"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

interface TimePeriodButtonsProps {
  selectedDuration: HistoryDuration;
  onDurationChange: (duration: HistoryDuration) => void;
}

/**
 * Time Period Buttons - copied from Uniswap's TimePeriodOptionButtons.tsx
 */
function TimePeriodButtons({ selectedDuration, onDurationChange }: TimePeriodButtonsProps) {
  return (
    <div className="flex rounded-full border border-sidebar-border">
      {TIME_PERIODS.map((period, index) => (
        <button
          key={period.value}
          onClick={() => onDurationChange(period.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            index === 0 && 'rounded-l-full',
            index === TIME_PERIODS.length - 1 && 'rounded-r-full',
            index !== TIME_PERIODS.length - 1 && 'border-r border-sidebar-border',
            selectedDuration === period.value
              ? 'bg-sidebar-accent text-white'
              : 'text-muted-foreground hover:bg-sidebar-accent/50'
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

interface ResetButtonProps {
  onReset: () => void;
  isFullRange?: boolean;
}

/**
 * Reset Button - copied from Uniswap's ResetActionButton.tsx
 */
function ResetButton({ onReset, isFullRange }: ResetButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onReset}
      disabled={isFullRange}
      className={cn(
        'text-xs text-muted-foreground hover:text-white',
        isFullRange && 'opacity-50 cursor-not-allowed'
      )}
    >
      Reset
    </Button>
  );
}

export interface LiquidityRangeActionButtonsProps {
  selectedDuration: HistoryDuration;
  onDurationChange: (duration: HistoryDuration) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterRange: () => void;
  onReset: () => void;
  isFullRange?: boolean;
}

/**
 * Combined action buttons component - copied from Uniswap's LiquidityRangeActionButtons.tsx
 */
export function LiquidityRangeActionButtons({
  selectedDuration,
  onDurationChange,
  onZoomIn,
  onZoomOut,
  onCenterRange,
  onReset,
  isFullRange,
}: LiquidityRangeActionButtonsProps) {
  return (
    <div className="flex flex-row justify-between items-center py-3 px-4 gap-3">
      <TimePeriodButtons
        selectedDuration={selectedDuration}
        onDurationChange={onDurationChange}
      />
      <div className="flex flex-row items-center gap-3">
        <ZoomButtons
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onCenterRange={onCenterRange}
          isFullRange={isFullRange}
        />
        <ResetButton onReset={onReset} isFullRange={isFullRange} />
      </div>
    </div>
  );
}

export default LiquidityRangeActionButtons;
