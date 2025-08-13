"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TOKEN_DEFINITIONS, type TokenSymbol } from "@/lib/pools-config";

interface TickRangePortfolioProps {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  tickSpacing: number;
  poolId?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  currentPrice?: string | null;
  bare?: boolean;
  bucketData?: BucketData[];
  isLoading?: boolean;
}

interface BucketData {
  tickLower: number;
  tickUpper: number;
  midTick: number;
  liquidityToken0: string;
}

// Brand-tuned portfolio version of TickRangePreview
// - Higher contrast on area and markers
// - Uses portfolio greys and Alphix accent
// - Slightly shorter margins for tight table rows
export function TickRangePortfolio({
  tickLower,
  tickUpper,
  currentTick,
  tickSpacing,
  poolId,
  token0Symbol,
  token1Symbol,
  currentPrice,
  bare,
  bucketData: externalBucketData = [],
  isLoading: externalIsLoading = false,
}: TickRangePortfolioProps) {
  // Use external data if provided, otherwise fall back to internal fetching
  const bucketData = externalBucketData;
  const isLoading = externalIsLoading;
  
  // Track if we've ever had data to prevent flicker
  const [hasHadData, setHasHadData] = useState(false);
  
  useEffect(() => {
    if (bucketData.length > 0 && !hasHadData) {
      setHasHadData(true);
    }
  }, [bucketData.length, hasHadData]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const BAR_COUNT = 15; // fixed count for portfolio rows
  const BAR_PX = 2;
  const GAP_PX = 4;

  const xDomain = useMemo(() => {
    if (!isFinite(tickLower) || !isFinite(tickUpper) || tickLower >= tickUpper) {
      return [-1000, 1000];
    }
    const positionRange = Math.abs(tickUpper - tickLower);
    const maxRange = 5000;
    const padding = Math.min(positionRange * 0.5, maxRange * 0.3);
    const minTick = Math.min(tickLower, tickUpper) - padding;
    const maxTick = Math.max(tickLower, tickUpper) + padding;
    const finalRange = maxTick - minTick;
    if (finalRange > maxRange) {
      const center = (tickLower + tickUpper) / 2;
      return [center - maxRange / 2, center + maxRange / 2];
    }
    return [minTick, maxTick];
  }, [tickLower, tickUpper, currentTick, currentPrice]);

  const shouldFlipDenomination = useMemo(() => {
    if (!currentPrice || !token0Symbol || !token1Symbol) return false;
    const currentPriceNum = parseFloat(currentPrice);
    const inversePrice = 1 / currentPriceNum;
    return inversePrice > currentPriceNum;
  }, [currentPrice, token0Symbol, token1Symbol]);

  const isAxisFlipped = useMemo(() => {
    if (!currentTick || !currentPrice || !token0Symbol || bucketData.length < 2) {
      return false;
    }
    const currentPriceNum = parseFloat(currentPrice);
    const tickSortedBuckets = [...bucketData].sort((a, b) => a.midTick - b.midTick);
    const firstByTick = tickSortedBuckets[0];
    const secondByTick = tickSortedBuckets[1];
    const firstDelta = Math.pow(1.0001, firstByTick.midTick - currentTick);
    const secondDelta = Math.pow(1.0001, secondByTick.midTick - currentTick);
    let firstPrice: number;
    let secondPrice: number;
    if (shouldFlipDenomination) {
      firstPrice = 1 / (currentPriceNum * firstDelta);
      secondPrice = 1 / (currentPriceNum * secondDelta);
    } else {
      firstPrice = currentPriceNum * firstDelta;
      secondPrice = currentPriceNum * secondDelta;
    }
    const shouldFlip = firstPrice > secondPrice;
    return shouldFlip;
  }, [currentTick, currentPrice, token0Symbol, bucketData, shouldFlipDenomination]);

  // Skip internal fetching if external data is provided
  useEffect(() => {
    if (externalBucketData.length > 0) return; // Use external data
    
    const fetchBucketData = async () => {
      if (!poolId || !tickSpacing) return;
      const [minTick, maxTick] = xDomain;
      if (!isFinite(minTick) || !isFinite(maxTick) || minTick >= maxTick) return;
      const requestData = {
        poolId,
        tickLower: Math.floor(minTick),
        tickUpper: Math.ceil(maxTick),
        tickSpacing: Number(tickSpacing),
        bucketCount: 25,
      };
      // Note: internal fetching disabled in portfolio context
    };
    fetchBucketData();
  }, [poolId, xDomain, tickSpacing, externalBucketData]);



  // Build quick lookup by tick range for bucketData
  const bucketMax = useMemo(() => {
    if (!bucketData.length) return 1;
    return Math.max(...bucketData.map((b) => Number.parseFloat(b.liquidityToken0) || 0), 1);
  }, [bucketData]);

  const [minTick, maxTick] = xDomain;

  const indexForTick = useCallback(
    (tick: number) => {
      if (!isFinite(minTick) || !isFinite(maxTick) || maxTick === minTick) return 0;
      const ratio = (tick - minTick) / (maxTick - minTick);
      const idx = Math.round(ratio * (BAR_COUNT - 1));
      return Math.max(0, Math.min(BAR_COUNT - 1, idx));
    },
    [minTick, maxTick]
  );

  const barHeights = useMemo(() => {
    // Force consistent height for all bars regardless of data
    return new Array(BAR_COUNT).fill(1.0); // Always use full height for now to debug
  }, []);

  const currentIdx = useMemo(() => indexForTick(currentTick), [currentTick, indexForTick]);
  const rangeStartIdx = useMemo(() => indexForTick(Math.min(tickLower, tickUpper)), [tickLower, tickUpper, indexForTick]);
  const rangeEndIdx = useMemo(() => indexForTick(Math.max(tickLower, tickUpper)), [tickLower, tickUpper, indexForTick]);

  // Only show loading skeleton on initial load, not after we've had data
  const showLoadingSkeleton = isLoading && bucketData.length === 0 && !hasHadData;

  const rowWidthPx = useMemo(() => {
    return BAR_COUNT * BAR_PX + Math.max(0, BAR_COUNT - 1) * GAP_PX;
  }, []);

  // Hover interactions
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [mouseX, setMouseX] = useState<number>(0);
  const isIndexInRange = useCallback(
    (idx: number) => idx >= rangeStartIdx && idx <= rangeEndIdx,
    [rangeStartIdx, rangeEndIdx]
  );

  // Sticky hover so tooltip does not flicker per-bar while swiping
  // Single moving tooltip logic: update hoverIndex based on cursor across the whole bar row
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setMouseX(Math.max(0, Math.min(x, rowWidthPx)));
    // map x to index by columns of BAR_PX + GAP_PX
    const per = BAR_PX + GAP_PX;
    let idx = Math.round(x / per);
    idx = Math.max(0, Math.min(BAR_COUNT - 1, idx));
    setHoverIndex(idx);
    setIsHovering(true);
  }, [rowWidthPx]);

  if (showLoadingSkeleton) {
    return (
      <div
        className={bare ? "w-full h-full overflow-hidden relative" : "w-full h-full bg-muted/20 rounded-md overflow-hidden relative"}
        style={{
          minHeight: 24,
          width: rowWidthPx,
        }}
      >
        <div
          className="absolute inset-0 flex items-center"
          style={{ gap: `${GAP_PX}px`, paddingLeft: 0, paddingRight: 0 }}
        >
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 bg-muted/60 animate-pulse"
              style={{ width: `${BAR_PX}px`, height: `40%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={bare ? "w-full h-full overflow-hidden relative" : "w-full h-full bg-muted/20 rounded-md overflow-hidden relative"}
      style={{
        minHeight: 24,
        width: rowWidthPx,
      }}
      onMouseLeave={() => { setHoverIndex(null); setIsHovering(false); }}
    >
      {/* Bars */}
      <div
        className="absolute inset-0 flex items-center"
        style={{
          gap: `${GAP_PX}px`,
          paddingLeft: 0,
          paddingRight: 0,
        }}
        onMouseMove={handleMouseMove}
      >
        {Array.from({ length: BAR_COUNT }).map((_, i) => {
          const heightPct = Math.round(barHeights[i] * 100);
          const isCurrent = i === currentIdx;
          const inRange = i >= rangeStartIdx && i <= rangeEndIdx;
          // Determine near-edge for the position overall (not per bar)
          const positionWidthTicks = Math.max(1, Math.abs(tickUpper - tickLower));
          const distToEdgeTicks = Math.min(
            Math.max(0, currentTick - tickLower),
            Math.max(0, tickUpper - currentTick)
          );
          const positionInRange = currentTick >= tickLower && currentTick <= tickUpper;
          const isNearEdge = positionInRange && (distToEdgeTicks / positionWidthTicks) <= 0.15;
          const baseGrey = 'hsl(0 0% 60%)';
          const rangeGrey = 'hsl(0 0% 40%)';
          const effectiveHover = hoverIndex;
          const hoverActive = effectiveHover !== null && isHovering;
          const hoveredInRange = hoverActive && isIndexInRange(effectiveHover!);
          const isNeighbor = effectiveHover !== null && (i === effectiveHover || i === effectiveHover - 1 || i === effectiveHover + 1);
          // Only emphasize in-range, never emphasize outside on hover
          const emphasize = inRange;
          const colorForBar = (() => {
            if (isCurrent) return positionInRange ? '#22c55e' : '#ef4444';
            return emphasize ? baseGrey : rangeGrey;
          })();
          const scaledHeight = Math.round(heightPct * 0.4);
          let barHeight = Math.max(16, scaledHeight);
          if (isNeighbor) barHeight = Math.min(100, Math.round(barHeight * 1.25));
          return (
            <div
              key={i}
              className="flex-shrink-0"
              style={{
                width: `${BAR_PX}px`,
                height: `${barHeight}%`,
                backgroundColor: colorForBar,
                opacity: isNeighbor ? 1 : (isCurrent ? 0.95 : 0.92),
              }}
            />
          );
        })}
      </div>

      {/* Single moving tooltip using shadcn; trigger is a tiny absolutely positioned element following the cursor */}
      {isHovering && hoverIndex !== null && (() => {
        const idx = hoverIndex ?? 0;
        const inRange = idx >= rangeStartIdx && idx <= rangeEndIdx;
        if (!inRange && idx !== currentIdx) return null;
        const s0 = (token0Symbol || '') as TokenSymbol;
        const s1 = (token1Symbol || '') as TokenSymbol;
        const showPrice = idx === currentIdx && currentPrice && s0 && s1;
        const content = showPrice ? (() => {
          const dec0 = TOKEN_DEFINITIONS[s0]?.displayDecimals ?? 4;
          const dec1 = TOKEN_DEFINITIONS[s1]?.displayDecimals ?? 4;
          const priceNum = Number(currentPrice);
          if (!isFinite(priceNum) || priceNum <= 0) return '';
          const priority: Record<string, number> = { aUSDC: 10, aUSDT: 9, USDC: 8, USDT: 7, aETH: 6, ETH: 5, YUSD: 4, mUSDT: 3 };
          const base = (priority[s1] || 0) > (priority[s0] || 0) ? s1 : s0;
          const invert = base === s0;
          const value = invert ? 1 / priceNum : priceNum;
          const decimals = invert ? (TOKEN_DEFINITIONS[s0]?.displayDecimals ?? dec0) : (TOKEN_DEFINITIONS[s1]?.displayDecimals ?? dec1);
          const denom = invert ? s0 : s1;
          const formatted = value.toLocaleString('de-DE', { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals });
          return `${formatted} ${denom}`;
        })() : 'Liquidity Range';
        return (
          <TooltipProvider>
            <Tooltip open disableHoverableContent>
              <TooltipTrigger asChild>
                <div style={{ position: 'absolute', left: `${Math.max(0, Math.min(mouseX, rowWidthPx))}px`, top: 0, width: 1, height: 1 }} />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                {content}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })()}
    </div>
  );
}

export default TickRangePortfolio;


