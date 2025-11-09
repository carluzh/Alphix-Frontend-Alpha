"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CircleHelp } from 'lucide-react';
import { useSlippageValidation } from '@/hooks/useSlippage';
import { MAX_CUSTOM_SLIPPAGE_TOLERANCE } from '@/lib/slippage-constants';

interface SlippageControlProps {
  currentSlippage: number;
  isAuto: boolean;
  autoSlippage: number;
  onSlippageChange: (value: number) => void;
  onAutoToggle: () => void;
  onCustomToggle: () => void;
}

export function SlippageControl({
  currentSlippage,
  isAuto,
  autoSlippage,
  onSlippageChange,
  onAutoToggle,
  onCustomToggle,
}: SlippageControlProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { isCritical, showWarning, warningMessage } = useSlippageValidation(currentSlippage);

  // Update input value when currentSlippage changes externally
  React.useEffect(() => {
    if (!isExpanded) {
      setInputValue(currentSlippage.toFixed(2));
    }
  }, [currentSlippage, isExpanded]);

  const handleClick = () => {
    setIsExpanded(true);
    setInputValue(currentSlippage.toFixed(2));
    // Focus input after expansion animation
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty input
    if (value === '') {
      setInputValue('');
      return;
    }

    // Allow decimal point
    if (value === '.') {
      setInputValue('0.');
      return;
    }

    // Validate numeric input
    if (!/^\d*\.?\d*$/.test(value)) {
      return;
    }

    // Limit to 2 decimal places
    const parts = value.split('.');
    if (parts[1] && parts[1].length > 2) {
      return;
    }

    setInputValue(value);

    // Parse and update if valid
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      const capped = Math.min(parsed, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
      onSlippageChange(capped);
      // Switch to custom mode
      if (isAuto) {
        onCustomToggle();
      }
    }
  };

  const handleBlur = () => {
    // Format the value properly on blur
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      setInputValue(parsed.toFixed(2));
    } else {
      // Reset to current value if invalid
      setInputValue(currentSlippage.toFixed(2));
    }
    setIsExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setInputValue(currentSlippage.toFixed(2));
      setIsExpanded(false);
    }
  };

  const handleAutoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Update to Auto mode
    onAutoToggle();

    // Update input value to show auto slippage and collapse
    setInputValue(autoSlippage.toFixed(2));
    setIsExpanded(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <span>Max Slippage</span>
                <CircleHelp className="h-3 w-3" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs max-w-xs">
              <p>
                The maximum difference between your expected price and the execution price.
                Auto mode dynamically adjusts based on market conditions.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex items-center gap-1.5">
          {!isExpanded ? (
            // Collapsed view - show EITHER "Auto" OR custom percentage
            <button
              type="button"
              onClick={handleClick}
              className={cn(
                "text-foreground/80 font-medium hover:text-foreground transition-colors",
                isCritical && "text-red-500"
              )}
            >
              {isAuto ? (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted/40 text-muted-foreground">
                  Auto
                </span>
              ) : (
                <span className="underline">{currentSlippage.toFixed(2)}%</span>
              )}
            </button>
          ) : (
            // Expanded view - inline input with Auto button
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onMouseDown={handleAutoClick}
                className="px-1.5 py-0.5 text-[10px] font-normal rounded-md border border-sidebar-border bg-muted/20 text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                Auto
              </button>

              <div className="flex items-center gap-0.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  className={cn(
                    "w-12 px-1 py-0.5 text-xs text-center bg-background rounded outline-none",
                    "focus:ring-1 focus:ring-sidebar-border transition-all",
                    isCritical && "text-red-500"
                  )}
                  placeholder="0.50"
                />
                <span className="text-xs">%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Warning Message */}
      <AnimatePresence>
        {showWarning && !isAuto && warningMessage && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="text-xs text-red-500 mt-1">
              {warningMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
