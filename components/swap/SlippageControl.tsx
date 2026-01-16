"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSlippageValidation } from '@/hooks/useSlippage';
import { MAX_CUSTOM_SLIPPAGE_TOLERANCE } from '@/lib/slippage/slippage-constants';

interface SlippageControlProps {
  currentSlippage: number;
  isAuto: boolean;
  autoSlippage: number;
  onSlippageChange: (value: number) => void;
  onAutoToggle: () => void;
  onCustomToggle: () => void;
}

const PRESETS = [0.05, 0.1, 0.5, 1];

export function SlippageControl({
  currentSlippage,
  isAuto,
  autoSlippage,
  onSlippageChange,
  onAutoToggle,
  onCustomToggle,
}: SlippageControlProps) {
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const [isCustomEditing, setIsCustomEditing] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { isCritical } = useSlippageValidation(currentSlippage);

  const matchesPreset = (value: number) => {
    return PRESETS.some(preset => Math.abs(value - preset) < 0.001);
  };

  const displayValue = isAuto ? autoSlippage : currentSlippage;

  // Close picker when clicking outside
  React.useEffect(() => {
    if (!isPickerOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
        setIsCustomEditing(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPickerOpen]);

  const handleValueClick = () => {
    setIsPickerOpen(true);
  };

  const handlePresetClick = (preset: number) => {
    onSlippageChange(preset);
    if (isAuto) {
      onCustomToggle();
    }
    setIsPickerOpen(false);
    setIsCustomEditing(false);
  };

  const handleCustomClick = () => {
    setIsCustomEditing(true);
    setInputValue('');
    if (isAuto) {
      onCustomToggle();
    }
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (value === '') {
      setInputValue('');
      return;
    }

    if (value === '.') {
      setInputValue('0.');
      return;
    }

    if (!/^\d*\.?\d*$/.test(value)) {
      return;
    }

    const parts = value.split('.');
    if (parts[1] && parts[1].length > 2) {
      return;
    }

    setInputValue(value);

    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      const capped = Math.min(parsed, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
      onSlippageChange(capped);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const parsed = parseFloat(inputValue);
      if (!isNaN(parsed) && parsed > 0) {
        const capped = Math.min(parsed, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
        onSlippageChange(capped);
        setInputValue(capped.toFixed(2));
      }
      setIsPickerOpen(false);
      setIsCustomEditing(false);
    } else if (e.key === 'Escape') {
      setIsPickerOpen(false);
      setIsCustomEditing(false);
      setInputValue('');
    }
  };

  const handleInputBlur = () => {
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed) && parsed > 0) {
      const capped = Math.min(parsed, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
      setInputValue(capped.toFixed(2));
      onSlippageChange(capped);
    } else {
      setInputValue('');
    }
    setIsPickerOpen(false);
    setIsCustomEditing(false);
  };

  return (
    <div ref={containerRef} className="h-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground h-5">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>Max Slippage</span>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} className="px-2 py-1 text-xs max-w-xs">
              <p>
                The maximum difference between your expected price and the execution price.
                {isAuto && (
                  <> Auto-slippage is calculated based on market conditions, route complexity, and token pair volatility.</>
                )}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex items-center gap-1 h-5">
          {!isPickerOpen ? (
            <button
              type="button"
              onClick={handleValueClick}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              {displayValue.toFixed(2)}%
            </button>
          ) : (
            <div className="flex items-center gap-1 h-5">
              {PRESETS.map((preset) => {
                const isActive = !isAuto && Math.abs(currentSlippage - preset) < 0.001;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className={cn(
                      "h-7 px-2.5 text-xs rounded-md transition-colors",
                      isActive
                        ? "bg-muted/50 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {preset}%
                  </button>
                );
              })}

              {isCustomEditing ? (
                <div className="flex items-center gap-0.5 h-5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown}
                    className={cn(
                      "w-14 h-7 px-2 text-xs text-center bg-transparent rounded-md outline-none border border-sidebar-border",
                      "focus:border-muted-foreground transition-colors",
                      isCritical && "text-red-500 border-red-500/50"
                    )}
                    placeholder="0.00"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCustomClick}
                  className={cn(
                    "h-7 px-2.5 text-xs rounded-md transition-colors",
                    !isAuto && !matchesPreset(currentSlippage)
                      ? "bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  Custom
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
