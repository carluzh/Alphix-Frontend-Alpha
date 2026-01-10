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

function ZoomButtons({ onZoomIn, onZoomOut, onCenterRange, isFullRange }: ZoomButtonsProps) {
  return (
    <div className="flex items-center rounded-lg border border-sidebar-border overflow-hidden">
      <button
        onClick={onZoomOut}
        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-150 cursor-pointer border-r border-sidebar-border"
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        onClick={onCenterRange}
        disabled={isFullRange}
        className={cn(
          'h-7 w-7 flex items-center justify-center transition-colors duration-150 cursor-pointer border-r border-sidebar-border',
          isFullRange
            ? 'text-muted-foreground/50 cursor-not-allowed'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
        title="Center range"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      <button
        onClick={onZoomIn}
        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-150 cursor-pointer"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
    </div>
  );
}

interface TimePeriodButtonsProps {
  selectedDuration: HistoryDuration;
  onDurationChange: (duration: HistoryDuration) => void;
}

function TimePeriodButtons({ selectedDuration, onDurationChange }: TimePeriodButtonsProps) {
  return (
    <div className="flex items-center gap-1">
      {TIME_PERIODS.map((period) => (
        <button
          key={period.value}
          onClick={() => onDurationChange(period.value)}
          className={cn(
            'h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none',
            selectedDuration === period.value
              ? 'bg-muted/50 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
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

function ResetButton({ onReset, isFullRange }: ResetButtonProps) {
  return (
    <button
      onClick={onReset}
      disabled={isFullRange}
      className={cn(
        'h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none',
        isFullRange
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      Reset
    </button>
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
