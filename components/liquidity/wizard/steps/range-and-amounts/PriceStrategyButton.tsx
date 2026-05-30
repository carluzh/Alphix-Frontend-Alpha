'use client';

import { cn } from '@/lib/utils';
import { PriceStrategyConfig } from './strategies';

// Price Strategy button (Uniswap's DefaultPriceStrategyComponent style)
interface PriceStrategyButtonProps {
  strategy: PriceStrategyConfig;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export function PriceStrategyButton({ strategy, selected, onSelect, disabled }: PriceStrategyButtonProps) {
  const renderDisplay = () => {
    // Handle special formatting for different strategy types
    if (strategy.id === 'stable_skewed') {
      return <>+1 <span className="text-muted-foreground/50">/</span> −3 ticks</>;
    }
    if (strategy.id === 'skewed') {
      return <>+10% <span className="text-muted-foreground/50">/</span> −30%</>;
    }
    if (strategy.id === 'full') {
      return <>0 <span className="text-muted-foreground/50">→</span> ∞</>;
    }
    return strategy.display;
  };

  // Uses Disconnect button hover colors (bg-accent, border-white/30)
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex flex-col justify-between p-4 rounded-lg border border-sidebar-border bg-muted/30 transition-colors text-left min-h-[120px]',
        selected && 'bg-accent border-white/30',
        !selected && 'hover:bg-accent/50 hover:border-white/15',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Title and display value */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">
          {strategy.title}
        </span>
        <span className="text-base font-semibold text-white">
          {renderDisplay()}
        </span>
      </div>
      {/* Description */}
      <span className="text-xs text-muted-foreground/70 leading-tight mt-2">
        {strategy.description}
      </span>
    </button>
  );
}
