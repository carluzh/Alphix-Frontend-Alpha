'use client';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

// Min/Max price input (Uniswap RangeAmountInput style)
interface RangeInputProps {
  label: 'Min' | 'Max';
  percentFromCurrent: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  position: 'left' | 'right';
}

export function RangeInput({
  label,
  percentFromCurrent,
  value,
  onChange,
  onBlur,
  onIncrement,
  onDecrement,
  disabled,
  position,
}: RangeInputProps) {
  return (
    <div className={cn(
      'flex flex-row justify-between flex-1 px-4 py-4',
      position === 'left' ? 'border-r border-sidebar-border' : '',
      disabled && 'opacity-50'
    )}>
      <div className="flex flex-col gap-1 flex-1 overflow-hidden">
        <span className="text-sm font-medium text-muted-foreground">
          {label} price
        </span>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="bg-transparent border-none text-xl md:text-xl font-semibold p-0 h-auto text-white focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="0"
        />
        <span className="text-sm text-muted-foreground mt-1">
          {percentFromCurrent}
        </span>
      </div>
      {/* Right side: +/- buttons */}
      <div className="flex flex-col gap-2 justify-center">
        <button
          onClick={onIncrement}
          disabled={disabled}
          className="w-8 h-8 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 flex items-center justify-center text-base font-medium text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          +
        </button>
        <button
          onClick={onDecrement}
          disabled={disabled}
          className="w-8 h-8 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 flex items-center justify-center text-base font-medium text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          −
        </button>
      </div>
    </div>
  );
}
