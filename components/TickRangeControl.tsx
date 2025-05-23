"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MinusIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { useRef, useState, useCallback, useEffect } from "react";
import type { TokenSymbol } from "../lib/swap-constants";
import JSBI from 'jsbi';
import { TickMath } from '@uniswap/v3-sdk';

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;

interface TickRangeControlProps {
  tickLower: string;
  tickUpper: string;
  currentPoolTick: number | null;
  onTickLowerChange: (value: string) => void;
  onTickUpperChange: (value: string) => void;
  onSetFullRange: () => void;
  disabled?: boolean;
  minTickBoundary?: number;
  maxTickBoundary?: number;
  tickSpacing?: number;
  token0Symbol?: TokenSymbol | string;
  token1Symbol?: TokenSymbol | string;
  currentPrice?: string | null;
  priceAtTickLower?: string | null;
  priceAtTickUpper?: string | null;
}

export function TickRangeControl({
  tickLower,
  tickUpper,
  currentPoolTick,
  onTickLowerChange,
  onTickUpperChange,
  onSetFullRange,
  disabled,
  minTickBoundary = SDK_MIN_TICK,
  maxTickBoundary = SDK_MAX_TICK,
  tickSpacing = DEFAULT_TICK_SPACING,
  token0Symbol,
  token1Symbol,
  currentPrice,
  priceAtTickLower,
  priceAtTickUpper,
}: TickRangeControlProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDraggingLower, setIsDraggingLower] = useState(false);
  const [isDraggingUpper, setIsDraggingUpper] = useState(false);

  const [visualMinTick, setVisualMinTick] = useState<number>(minTickBoundary);
  const [visualMaxTick, setVisualMaxTick] = useState<number>(maxTickBoundary);

  const handleAdjustTick = (
    currentValueStr: string,
    amount: number,
    setter: (value: string) => void,
    // The boundary and isIncrement parameters were part of the original signature 
    // but not strictly used in the simplified clamping logic below.
    // They are kept for signature consistency if a more complex logic were to be reintroduced.
    _boundary: number, 
    _isIncrement: boolean
  ) => {
    let currentValue = parseInt(currentValueStr, 10);
    if (isNaN(currentValue)) {
      // If current value is not a number, try to base it off currentPoolTick or default to 0
      currentValue = currentPoolTick !== null && currentPoolTick !== undefined 
        ? Math.floor(currentPoolTick / tickSpacing) * tickSpacing 
        : 0;
    }
    let newValue = currentValue + amount;

    // Clamp to the overall min/max boundaries defined by props or SDK defaults
    newValue = Math.max(minTickBoundary, Math.min(maxTickBoundary, newValue));
    
    // Align to tickSpacing
    newValue = Math.round(newValue / tickSpacing) * tickSpacing;

    // Update the state via the setter
    setter(newValue.toString());
  };

  useEffect(() => {
    const effectiveMinBoundary = minTickBoundary ?? SDK_MIN_TICK;
    const effectiveMaxBoundary = maxTickBoundary ?? SDK_MAX_TICK;

    if (currentPoolTick !== null && currentPoolTick !== undefined) {
        const PRICE_CHANGE_LOWER_RATIO = 0.20; // -80%
        const PRICE_CHANGE_UPPER_RATIO = 3.00; // +200%
        // Math.log(1.0001) is a constant, approx 0.0000999950003
        const LOG_1_0001 = 0.0000999950003; 

        const deltaTickLower = Math.log(PRICE_CHANGE_LOWER_RATIO) / LOG_1_0001;
        const deltaTickUpper = Math.log(PRICE_CHANGE_UPPER_RATIO) / LOG_1_0001;

        let calcVisualMinTick = currentPoolTick + deltaTickLower;
        let calcVisualMaxTick = currentPoolTick + deltaTickUpper;

        // Ensure min < max, should be the case with log ratios but as safeguard
        if (calcVisualMinTick > calcVisualMaxTick) {
            // This case should ideally not be hit with correct delta calculations
            [calcVisualMinTick, calcVisualMaxTick] = [calcVisualMaxTick, calcVisualMinTick];
        }
        
        let alignedVisualMinTick = Math.round(calcVisualMinTick / tickSpacing) * tickSpacing;
        let alignedVisualMaxTick = Math.round(calcVisualMaxTick / tickSpacing) * tickSpacing;

        // Clamp to SDK boundaries
        alignedVisualMinTick = Math.max(SDK_MIN_TICK, alignedVisualMinTick);
        alignedVisualMaxTick = Math.min(SDK_MAX_TICK, alignedVisualMaxTick);

        // Ensure a minimum visual span if clamping drastically reduces the range or inverts it
        const minRequiredTickSpan = tickSpacing * 20; // e.g., 1200 ticks for spacing 60
        if (alignedVisualMaxTick < alignedVisualMinTick + minRequiredTickSpan) {
            const centerTick = currentPoolTick;
            // Attempt to create a reasonable span around the current tick
            const fallbackMinExpansion = minRequiredTickSpan * 5; // e.g. 6000 ticks
            const fallbackMaxExpansion = minRequiredTickSpan * 10; // e.g. 12000 ticks

            alignedVisualMinTick = Math.max(SDK_MIN_TICK, Math.round((centerTick - fallbackMinExpansion) / tickSpacing) * tickSpacing);
            alignedVisualMaxTick = Math.min(SDK_MAX_TICK, Math.round((centerTick + fallbackMaxExpansion) / tickSpacing) * tickSpacing);
            
            // If still problematic (e.g., centerTick is too close to SDK_MIN/MAX), use full boundaries
            if (alignedVisualMaxTick < alignedVisualMinTick + minRequiredTickSpan) {
                 alignedVisualMinTick = effectiveMinBoundary;
                 alignedVisualMaxTick = effectiveMaxBoundary;
                 console.warn("[TickRangeControl] Visual range calculation resulted in narrow/inverted span after clamping, falling back to effective boundaries.");
            }
        }
         
         if (alignedVisualMinTick >= alignedVisualMaxTick) { 
            setVisualMinTick(effectiveMinBoundary);
            setVisualMaxTick(effectiveMaxBoundary);
            console.warn("[TickRangeControl] Final visualMinTick was >= visualMaxTick, falling back to effective boundaries.");
         } else {
            setVisualMinTick(alignedVisualMinTick);
            setVisualMaxTick(alignedVisualMaxTick);
         }

    } else {
        // Fallback if currentPoolTick is not available
        setVisualMinTick(effectiveMinBoundary);
        setVisualMaxTick(effectiveMaxBoundary);
        console.warn("[TickRangeControl] currentPoolTick not available, using default boundaries for visual range.");
    }
}, [currentPoolTick, tickSpacing, minTickBoundary, maxTickBoundary]);

  const numericTickLower = parseInt(tickLower);
  const numericTickUpper = parseInt(tickUpper);

  // Visualization logic
  const visRangeMin = visualMinTick;
  const visRangeMax = visualMaxTick;
  const totalVisRange = visRangeMax - visRangeMin;

  const getPositionPercent = (tick: number | string | null | undefined) => {
    if (tick === null || tick === undefined) return 0;
    const numericTick = typeof tick === 'string' ? parseInt(tick) : tick;
    if (isNaN(numericTick) || totalVisRange <=0) return 0;
    const clampedTick = Math.max(visRangeMin, Math.min(visRangeMax, numericTick));
    return ((clampedTick - visRangeMin) / totalVisRange) * 100;
  };

  const currentTickPercent = getPositionPercent(currentPoolTick);
  const lowerTickPercent = getPositionPercent(numericTickLower);
  const upperTickPercent = getPositionPercent(numericTickUpper);

  const formatPrice = (priceStr: string | null | undefined, quoteTokenSymbol?: TokenSymbol | string) => {
    if (!priceStr) return "-";
    const priceNum = parseFloat(priceStr);
    if (isNaN(priceNum)) return "-";

    if (quoteTokenSymbol?.toUpperCase().includes("YUSD")) {
        if (priceNum > 0 && priceNum < 0.01) return "<$0.01";
        return `$${priceNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (priceNum === 0) return "0.00";
    
    // For very large numbers not YUSD, avoid scientific notation and use commas
    if (priceNum > 100000) { // Arbitrary threshold for large numbers
        return priceNum.toLocaleString(undefined, { maximumFractionDigits: 2 }); 
    }
    // For very small numbers or reasonably sized numbers, toPrecision is fine
    if (priceNum < 0.00001 && priceNum > 0) return "<0.00001";
    return priceNum.toPrecision(5);
  };

  const calculatePercentageChange = (price1Str: string | null | undefined, price2Str: string | null | undefined) => {
    if (!price1Str || !price2Str) return null;
    const price1 = parseFloat(price1Str);
    const price2 = parseFloat(price2Str);
    if (isNaN(price1) || isNaN(price2) || price1 === 0) return null;
    const diff = price2 - price1;
    const percentage = (diff / price1) * 100;
    return percentage;
  };

  const lowerPercentageChange = calculatePercentageChange(currentPrice, priceAtTickLower);
  const upperPercentageChange = calculatePercentageChange(currentPrice, priceAtTickUpper);

  // Determine if the selected range is visually active within the zoomed view
  const isLowerTickOutsideVisual = !isNaN(numericTickLower) && numericTickLower < visualMinTick;
  const isUpperTickOutsideVisual = !isNaN(numericTickUpper) && numericTickUpper > visualMaxTick;
  
  const isRangeVisuallyActiveAndValid = 
    !isNaN(numericTickLower) && !isNaN(numericTickUpper) &&
    numericTickLower >= visualMinTick && 
    numericTickUpper <= visualMaxTick && 
    numericTickLower < numericTickUpper;

  // Determine the display ticks for the highlight bar, clamped to visual range
  const displayTickLowerForHighlight = isNaN(numericTickLower) ? visRangeMin : Math.max(numericTickLower, visRangeMin);
  const displayTickUpperForHighlight = isNaN(numericTickUpper) ? visRangeMax : Math.min(numericTickUpper, visRangeMax);

  const highlightLeftPercent = getPositionPercent(displayTickLowerForHighlight);
  const highlightWidthPercent = Math.max(0, getPositionPercent(displayTickUpperForHighlight) - highlightLeftPercent);
  
  const barBgClass = isRangeVisuallyActiveAndValid ? 'bg-orange-500/30' : 'bg-slate-400/30';
  const handleBgClass = isRangeVisuallyActiveAndValid ? 'bg-orange-600' : 'bg-slate-500';
  const handleBorderClass = isRangeVisuallyActiveAndValid ? 'border-orange-600' : 'border-slate-500';

  const getTickFromMouseEvent = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    if (!barRef.current) return null;
    const barRect = barRef.current.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const percent = (clientX - barRect.left) / barRect.width;
    let newTick = visRangeMin + percent * totalVisRange;
    newTick = Math.round(newTick / tickSpacing) * tickSpacing; // Align to tickSpacing
    return newTick;
  }, [visRangeMin, totalVisRange, tickSpacing]);

  const handleDrag = useCallback((event: MouseEvent | TouchEvent) => {
    event.preventDefault(); // Prevent text selection/scrolling
    const newTick = getTickFromMouseEvent(event as any);
    if (newTick === null) return;

    if (isDraggingLower) {
      const upperNumeric = parseInt(tickUpper);
      const clampedNewTick = Math.max(minTickBoundary, Math.min(newTick, upperNumeric - tickSpacing));
      onTickLowerChange(clampedNewTick.toString());
    } else if (isDraggingUpper) {
      const lowerNumeric = parseInt(tickLower);
      const clampedNewTick = Math.min(maxTickBoundary, Math.max(newTick, lowerNumeric + tickSpacing));
      onTickUpperChange(clampedNewTick.toString());
    }
  }, [isDraggingLower, isDraggingUpper, getTickFromMouseEvent, onTickLowerChange, onTickUpperChange, tickLower, tickUpper, minTickBoundary, maxTickBoundary, tickSpacing]);

  const stopDragging = useCallback(() => {
    setIsDraggingLower(false);
    setIsDraggingUpper(false);
  }, []);

  useEffect(() => {
    if (isDraggingLower || isDraggingUpper) {
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', stopDragging);
      document.addEventListener('touchmove', handleDrag);
      document.addEventListener('touchend', stopDragging);
    } else {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDragging);
      document.removeEventListener('touchmove', handleDrag);
      document.removeEventListener('touchend', stopDragging);
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDragging);
      document.removeEventListener('touchmove', handleDrag);
      document.removeEventListener('touchend', stopDragging);
    };
  }, [isDraggingLower, isDraggingUpper, handleDrag, stopDragging]);

  return (
    <div className="mt-4 space-y-3">
      {/* Row 1: Title and Full Range Button */}
      <div className="flex justify-between items-center">
        <Label className="text-sm font-medium">Set Price Range</Label>
        <Button variant="outline" size="sm" onClick={onSetFullRange} disabled={disabled}>
          Full Range
        </Button>
      </div>

      {/* Row 2: Current Price Display (centered) - THIS WILL BE MOVED AND REPOSITIONED */}
      {/* {currentPrice && token0Symbol && token1Symbol && (
        <div className="text-xs text-center text-muted-foreground mt-1 mb-0.5 tabular-nums">
          {token0Symbol?.toUpperCase().includes("YUSD") ? (
            <>{formatPrice(currentPrice, token0Symbol)}</>
          ) : (
            <div>1 {token1Symbol} = {formatPrice(currentPrice, token0Symbol)} {token0Symbol}</div>
          )}
        </div>
      )} */}

      {/* Row 3: Visual Bar and Price/Percentage Annotations - Structure will be modified */}
      {currentPoolTick !== null && (
        <div className="relative pt-5 pb-5"> {/* New parent for positioning context & spacing */} 
          {/* Current Price - Positioned Above Bar */} 
          {currentPrice && token0Symbol && token1Symbol && (
            <div 
              className="absolute text-xs text-center text-muted-foreground tabular-nums"
              style={{
                top: '0px', // Position in the padding-top area
                left: `${currentTickPercent}%`, 
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {token0Symbol?.toUpperCase().includes("YUSD") ? (
                <>{formatPrice(currentPrice, token0Symbol)}</>
              ) : (
                // Displaying as "1 T1 = X T0" for consistency with potential future needs, adjust if needed
                // For now, it will be the same as YUSD case if token0 is not YUSD
                <>{formatPrice(currentPrice, token0Symbol)} {token0Symbol}</> 
                // Alternative:  <div>1 {token1Symbol} = {formatPrice(currentPrice, token0Symbol)} {token0Symbol}</div>
              )}
            </div>
          )}

          {/* Visual Bar itself */}
          <div 
            ref={barRef} 
            className="h-8 bg-muted/30 flex items-center relative px-1 py-1 select-none cursor-grab"
            // Removed my-3 (handled by parent) and overflow-hidden
          >
            {/* Range Highlight - No change in logic, just parented differently */}
            {!isNaN(numericTickLower) && !isNaN(numericTickUpper) && numericTickLower < numericTickUpper && (
               <div
                  className={`absolute h-full ${barBgClass}`}
                  style={{
                    left: `${highlightLeftPercent}%`,
                    width: `${highlightWidthPercent}%`,
                  }}
               />
            )}

            {/* Current Tick Marker - Styling Updated */}
            <div
              className="absolute w-[1px] h-full transform -translate-x-1/2 z-10 pointer-events-none"
              style={{
                left: `${currentTickPercent}%`,
                // Updated gradient for a crisp dash starting with white
                backgroundImage: 'repeating-linear-gradient(to bottom, white, white 4px, transparent 4px, transparent 8px)',
              }}
              title={`Current Tick: ${currentPoolTick}`}
            />
            
            {/* Lower Tick Handle - No change in logic, just parented differently */}
            {!isNaN(numericTickLower) && (
              <div
                className={`absolute w-[2px] h-full ${handleBgClass} rounded-full transform -translate-x-1/2 border-[1px] ${handleBorderClass} cursor-ew-resize z-20`}
                style={{ left: `${lowerTickPercent}%` }}
                title={`Min Tick: ${numericTickLower}`}
                onMouseDown={(e) => { e.stopPropagation(); if (!disabled) setIsDraggingLower(true); }}
                onTouchStart={(e) => { e.stopPropagation(); if (!disabled) setIsDraggingLower(true); }}
              />
            )}

            {/* Upper Tick Handle - No change in logic, just parented differently */}
            {!isNaN(numericTickUpper) && (
              <div
                className={`absolute w-[2px] h-full ${handleBgClass} rounded-full transform -translate-x-1/2 border-[1px] ${handleBorderClass} cursor-ew-resize z-20`}
                style={{ left: `${upperTickPercent}%` }}
                title={`Max Tick: ${numericTickUpper}`}
                onMouseDown={(e) => { e.stopPropagation(); if (!disabled) setIsDraggingUpper(true); }}
                onTouchStart={(e) => { e.stopPropagation(); if (!disabled) setIsDraggingUpper(true); }}
              />
            )}
          </div>
          
          {/* Min Price / % Change - Positioned Below Bar & Conditional Display */}
          {!isLowerTickOutsideVisual && priceAtTickLower && lowerPercentageChange !== null && token0Symbol && token1Symbol && (
            <div 
              className="absolute text-xs text-orange-500 whitespace-nowrap tabular-nums"
              style={{
                bottom: '0px', // Position in the padding-bottom area
                left: `${lowerTickPercent}%`, 
                transform: 'translateX(-50%)',
              }}
            >
              {lowerPercentageChange === null ? 'Loading...' : `${lowerPercentageChange > 0 ? '+':''}${lowerPercentageChange.toFixed(1)}%`}
            </div>
          )}
          {/* Max Price / % Change - Positioned Below Bar & Conditional Display */}
          {!isUpperTickOutsideVisual && priceAtTickUpper && upperPercentageChange !== null && token0Symbol && token1Symbol && (
            <div 
              className="absolute text-xs text-orange-500 whitespace-nowrap tabular-nums"
              style={{
                bottom: '0px', // Position in the padding-bottom area
                left: `${upperTickPercent}%`, 
                transform: 'translateX(-50%)',
              }}
            >
              {upperPercentageChange === null ? 'Loading...' : `${upperPercentageChange > 0 ? '+':''}${upperPercentageChange.toFixed(1)}%`}
            </div>
          )}
        </div>
      )}

      {/* Row 4: Min/Max Tick Input Fields (as before) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label
            htmlFor="tickLower"
            className="text-xs text-muted-foreground"
          >
            Min Tick
          </Label>
          <div className="flex items-center mt-1">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-r-none"
              onClick={() =>
                handleAdjustTick(tickLower, -tickSpacing, onTickLowerChange, minTickBoundary, false)
              }
              disabled={disabled || (!isNaN(numericTickLower) && numericTickLower <= minTickBoundary)}
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Input
              id="tickLower"
              type="number"
              value={tickLower}
              onChange={(e) => onTickLowerChange(e.target.value)}
              placeholder={minTickBoundary.toString()}
              disabled={disabled}
              className="rounded-none text-center no-arrows focus-visible:ring-0 focus-visible:ring-offset-0"
              step={tickSpacing}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-l-none"
              onClick={() =>
                handleAdjustTick(tickLower, tickSpacing, onTickLowerChange, maxTickBoundary, true)
              }
              disabled={disabled || (!isNaN(numericTickLower) && !isNaN(numericTickUpper) && numericTickLower >= numericTickUpper - tickSpacing)}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div>
          <Label
            htmlFor="tickUpper"
            className="text-xs text-muted-foreground"
          >
            Max Tick
          </Label>
          <div className="flex items-center mt-1">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-r-none"
              onClick={() =>
                handleAdjustTick(tickUpper, -tickSpacing, onTickUpperChange, minTickBoundary, false)
              }
              disabled={disabled || (!isNaN(numericTickUpper) && !isNaN(numericTickLower) && numericTickUpper <= numericTickLower + tickSpacing)}
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Input
              id="tickUpper"
              type="number"
              value={tickUpper}
              onChange={(e) => onTickUpperChange(e.target.value)}
              placeholder={maxTickBoundary.toString()}
              disabled={disabled}
              className="rounded-none text-center no-arrows focus-visible:ring-0 focus-visible:ring-offset-0"
              step={tickSpacing}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-l-none"
              onClick={() =>
                handleAdjustTick(tickUpper, tickSpacing, onTickUpperChange, maxTickBoundary, true)
              }
              disabled={disabled || (!isNaN(numericTickUpper) && numericTickUpper >= maxTickBoundary)}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}