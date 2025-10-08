"use client";

import React, { useMemo } from 'react';

interface PositionRangePreviewProps {
  tickLower: number;
  tickUpper: number;
  currentTick: number | null;
  token0Symbol: string;
  token1Symbol: string;
  poolId: string;
}

export function PositionRangePreview({
  tickLower,
  tickUpper,
  currentTick,
  token0Symbol,
  token1Symbol,
  poolId
}: PositionRangePreviewProps) {
  const { isInRange, relativePosition } = useMemo(() => {
    if (currentTick === null) {
      return { isInRange: false, relativePosition: 50 };
    }

    const inRange = currentTick >= tickLower && currentTick <= tickUpper;

    // Calculate relative position of current price within the range (0-100%)
    const rangeSize = tickUpper - tickLower;
    const positionInRange = currentTick - tickLower;
    let position = rangeSize > 0 ? (positionInRange / rangeSize) * 100 : 50;

    // Clamp to visualization bounds (show slightly outside if out of range)
    position = Math.max(-10, Math.min(110, position));

    return { isInRange: inRange, relativePosition: position };
  }, [tickLower, tickUpper, currentTick]);

  // Convert ticks to approximate prices for display
  const lowerPrice = (1.0001 ** tickLower).toFixed(6);
  const upperPrice = (1.0001 ** tickUpper).toFixed(6);
  const currentPrice = currentTick !== null ? (1.0001 ** currentTick).toFixed(6) : 'N/A';

  return (
    <div className="w-64 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Position Range</span>
        <span className={`text-[10px] font-medium ${isInRange ? 'text-green-500' : 'text-red-500'}`}>
          {isInRange ? 'In Range' : 'Out of Range'}
        </span>
      </div>

      {/* Visual Range Bar */}
      <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
        {/* Position range (highlighted section) */}
        <div
          className={`absolute h-full ${isInRange ? 'bg-green-500/30' : 'bg-red-500/30'} rounded-full`}
          style={{ left: '0%', right: '0%' }}
        />

        {/* Current price indicator (vertical line) */}
        {currentTick !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#e85102]"
            style={{ left: `${Math.max(0, Math.min(100, relativePosition))}%` }}
          >
            {/* Dot at current price */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#e85102] border border-background" />
          </div>
        )}

        {/* Min/Max markers */}
        <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-border" />
        <div className="absolute top-0 bottom-0 right-0 w-0.5 bg-border" />
      </div>

      {/* Price Labels */}
      <div className="space-y-1.5 text-[10px]">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Min Price:</span>
          <span className="font-mono text-foreground">{lowerPrice}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Current Price:</span>
          <span className="font-mono text-[#e85102] font-medium">{currentPrice}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Max Price:</span>
          <span className="font-mono text-foreground">{upperPrice}</span>
        </div>
      </div>

      {/* Token Pair Info */}
      <div className="pt-2 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">
          {token0Symbol} / {token1Symbol}
        </span>
      </div>
    </div>
  );
}
