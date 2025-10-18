"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Area, ReferenceLine, ReferenceArea, Tooltip as RechartsTooltip, Brush } from "recharts";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits } from "viem";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK, Position as V4PositionSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import { getAddress, type Hex } from "viem";

// Import pools configuration
import poolsConfig from "@/config/pools.json";

// Helper function to get subgraphId from human-readable pool ID
const getSubgraphIdFromPoolId = (poolId: string): string | null => {
  const pool = poolsConfig.pools.find(p => p.id === poolId);
  return pool?.subgraphId || null;
};

// Chart data interfaces
interface CustomAxisLabel {
  tickValue: number;    
  displayLabel: string; 
}

interface HookPosition {
  pool: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

interface ProcessedPositionDetail {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  numericAmount0: number;
  numericAmount1: number;
  unifiedValueInToken0: number; 
}

interface BucketData {
  tickLower: number;
  tickUpper: number;
  midTick: number;
  liquidityToken0: string;
}

interface InteractiveRangeChartProps {
  selectedPoolId?: string;
  chainId?: number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  currentPoolTick: number | null;
  currentPrice: string | null;
  currentPoolSqrtPriceX96: string | null;
  tickLower: string;
  tickUpper: string;
  xDomain: [number, number];
  onRangeChange: (newLower: string, newUpper: string) => void;
  onXDomainChange?: (newDomain: [number, number]) => void;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolToken0?: any;
  poolToken1?: any;
  onDragStateChange?: (state: 'left' | 'right' | 'center' | null) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  onChartClick?: () => void; // NEW: Click handler to open modal
  readOnly?: boolean; // NEW: Disable all interactions
  forceDenominationBase?: TokenSymbol; // NEW: Override denomination from parent
  onReset?: () => void; // NEW: Reset handler for modal
}

export function InteractiveRangeChart({
  selectedPoolId,
  chainId,
  token0Symbol,
  token1Symbol,
  currentPoolTick,
  currentPrice,
  currentPoolSqrtPriceX96,
  tickLower,
  tickUpper,
  xDomain,
  onRangeChange,
  onXDomainChange,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolToken0,
  poolToken1,
  onDragStateChange,
  onLoadingChange,
  onChartClick,
  readOnly = false,
  forceDenominationBase,
  onReset,
}: InteractiveRangeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | 'center' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; tickLower: number; tickUpper: number } | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isPanningViewport, setIsPanningViewport] = useState(false);
  const panViewportStartRef = useRef<{ x: number; domain: [number, number] } | null>(null);
  const finalDragPositionRef = useRef<{ 
    tickLower: number; 
    tickUpper: number; 
    hitRightEdge: boolean; 
    hitLeftEdge: boolean; 
  } | null>(null);

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Net liquidity state for proper Uniswap V4 visualization
  const [rawHookPositions, setRawHookPositions] = useState<Array<HookPosition & { pool: string }> | null>(null);
  const [processedPositions, setProcessedPositions] = useState<ProcessedPositionDetail[] | null>(null);
  const [netLiquidityByTick, setNetLiquidityByTick] = useState<Map<number, number>>(new Map());

  const [isChartDataLoading, setIsChartDataLoading] = useState(false);
  
  // Throttle high-frequency updates with requestAnimationFrame
  const rafIdRangeRef = useRef<number | null>(null);
  const rafIdDomainRef = useRef<number | null>(null);
  const scheduleRangeChange = useCallback((lower: string, upper: string) => {
    if (rafIdRangeRef.current !== null) cancelAnimationFrame(rafIdRangeRef.current);
    const lowerArg = lower;
    const upperArg = upper;
    rafIdRangeRef.current = requestAnimationFrame(() => {
      onRangeChange(lowerArg, upperArg);
      rafIdRangeRef.current = null;
    });
  }, [onRangeChange]);
  
  const scheduleXDomainChange = useCallback((domain: [number, number]) => {
    if (!onXDomainChange) return;
    if (rafIdDomainRef.current !== null) cancelAnimationFrame(rafIdDomainRef.current);
    const domainArg: [number, number] = [domain[0], domain[1]];
    rafIdDomainRef.current = requestAnimationFrame(() => {
      onXDomainChange(domainArg);
      rafIdDomainRef.current = null;
    });
  }, [onXDomainChange]);

  // Helper function to determine the better base token for price display
  const determineBaseTokenForPriceDisplay = useCallback((token0: TokenSymbol, token1: TokenSymbol): TokenSymbol => {
    if (!token0 || !token1) return token0;

    // Priority order for quote tokens
    const quotePriority: Record<string, number> = {
      'aUSDC': 10,
      'aUSDT': 9,
      'USDC': 8,
      'USDT': 7,
      'aETH': 6,
      'ETH': 5,
      'YUSD': 4,
      'mUSDT': 3,
    };

    const token0Priority = quotePriority[token0] || 0;
    const token1Priority = quotePriority[token1] || 0;

    return token1Priority > token0Priority ? token1 : token0;
  }, []);

  // Determine optimal denomination for price display
  const optimalDenomination = useMemo(() => {
    if (!token0Symbol || !token1Symbol) return token0Symbol;
    return determineBaseTokenForPriceDisplay(token0Symbol, token1Symbol);
  }, [token0Symbol, token1Symbol, determineBaseTokenForPriceDisplay]);

  const isStablePool = useMemo(() => {
    if (!selectedPoolId) return false;
    const pool = poolsConfig.pools.find(p => p.id === selectedPoolId);
    return (pool?.type || '').toLowerCase() === 'stable';
  }, [selectedPoolId]);

  // Determine if we need to flip the denomination to show higher prices
  const shouldFlipDenomination = useMemo(() => {
    // If forced denomination is provided, use it
    if (forceDenominationBase) {
      return forceDenominationBase === token0Symbol;
    }

    if (!currentPrice || !token0Symbol || !token1Symbol) return false;

    const currentPriceNum = parseFloat(currentPrice);
    const inversePrice = 1 / currentPriceNum;

    // If the inverse price is larger, we should flip the denomination
    return inversePrice > currentPriceNum;
  }, [currentPrice, token0Symbol, token1Symbol, forceDenominationBase]);

  // Complete coordinate transformation system
  // When inverted, we create a display coordinate system that makes the chart appear as token1/token0
  const transformTickToDisplay = useCallback((tick: number): number => {
    if (!shouldFlipDenomination || !currentPoolTick) return tick;
    // Mirror around current price to create inverted display space
    return 2 * currentPoolTick - tick;
  }, [shouldFlipDenomination, currentPoolTick]);

  const transformDisplayToTick = useCallback((displayTick: number): number => {
    if (!shouldFlipDenomination || !currentPoolTick) return displayTick;
    // Inverse transformation: convert display space back to tick space
    return 2 * currentPoolTick - displayTick;
  }, [shouldFlipDenomination, currentPoolTick]);

  // Transform domain to display coordinates
  const displayDomain = useMemo((): [number, number] => {
    if (!shouldFlipDenomination) return xDomain;
    // When inverted, the display domain is flipped and transformed
    const [minTick, maxTick] = xDomain;
    const displayMin = transformTickToDisplay(maxTick);
    const displayMax = transformTickToDisplay(minTick);
    return [displayMin, displayMax];
  }, [xDomain, shouldFlipDenomination, transformTickToDisplay]);

  // Normalize price once so downstream calculations don't branch on every update
  const normalizedCurrentPriceNum = useMemo(() => {
    const p = currentPrice ? parseFloat(currentPrice) : NaN;
    if (!isFinite(p) || p <= 0) return NaN;
    return shouldFlipDenomination ? 1 / p : p;
  }, [currentPrice, shouldFlipDenomination]);

  // Remove complex domain transformation - keep it simple

  // Fetch raw positions (with caching to prevent zoom delays)
  useEffect(() => {
    let cancelled = false;
    const fetchPositionData = async () => {
      if (!selectedPoolId || !chainId || currentPoolTick === null) {
        setRawHookPositions(null);
        return;
      }

      const poolIdToSearch = getSubgraphIdFromPoolId(selectedPoolId);
      if (!poolIdToSearch) {
        setRawHookPositions(null);
        return;
      }

      setIsChartDataLoading(true);
      if (onLoadingChange) onLoadingChange(true);

      try {
        // Fetch raw positions without bucket parameters for caching
        const resp = await fetch('/api/liquidity/get-bucket-depths', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poolId: selectedPoolId,
            first: 2000
          })
        });

        if (!resp.ok) {
          throw new Error(`API failed: ${resp.status} ${resp.statusText}`);
        }

        const json = await resp.json();
        const positions = Array.isArray(json?.positions) ? json.positions : [];
        
        if (!cancelled) setRawHookPositions(positions);
      } catch (error) {
        console.error("[InteractiveRangeChart] Error fetching position data:", error);
        setRawHookPositions(null);
      } finally {
        setIsChartDataLoading(false);
        if (onLoadingChange) onLoadingChange(false);
      }
    };

    fetchPositionData();
    return () => { cancelled = true; };
  }, [selectedPoolId, chainId, currentPoolTick]); // Remove xDomain dependency for caching

  // Process positions into unified amount0 values
  useEffect(() => {
    if (
      rawHookPositions && rawHookPositions.length > 0 &&
      currentPoolTick !== null &&
      currentPoolSqrtPriceX96 !== null &&
      token0Symbol && token1Symbol && chainId &&
      poolToken0 && poolToken1
    ) {
      const processed: ProcessedPositionDetail[] = [];
      
      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];
      
      if (!token0Def || !token1Def) {
        setProcessedPositions(null);
        return;
      }

      const poolConfig = {
        fee: 3000,
        tickSpacing: defaultTickSpacing,
        hooks: "0x0000000000000000000000000000000000000000" as Hex
      };
      
      try {
        const sdkBaseToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
        const sdkBaseToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);
        const [sdkSortedToken0, sdkSortedToken1] = sdkBaseToken0.sortsBefore(sdkBaseToken1) 
            ? [sdkBaseToken0, sdkBaseToken1] 
            : [sdkBaseToken1, sdkBaseToken0];

        const poolSqrtPriceX96JSBI = JSBI.BigInt(currentPoolSqrtPriceX96);

        const poolForCalculations = new V4PoolSDK(
          sdkSortedToken0,
          sdkSortedToken1,
          poolConfig.fee,
          poolConfig.tickSpacing,
          poolConfig.hooks,
          poolSqrtPriceX96JSBI, 
          JSBI.BigInt(0),
          currentPoolTick
        );

        // Pre-calculate price conversion factor
        const priceNum = currentPrice ? parseFloat(currentPrice) : 0;
        const hasValidPrice = !isNaN(priceNum) && priceNum > 0;
        
        const token0Decimals = poolToken0.decimals;
        const token1Decimals = poolToken1.decimals;
        const token0Divisor = BigInt(10) ** BigInt(token0Decimals);
        const token1Divisor = BigInt(10) ** BigInt(token1Decimals);
      
        for (const position of rawHookPositions) {
          if (Number(position.tickLower) >= Number(position.tickUpper)) {
            continue;
          }
          
          if (position.tickLower !== undefined && position.tickUpper !== undefined && position.liquidity !== undefined) {
            try {
              const v4Position = new V4PositionSDK({
                pool: poolForCalculations,
                tickLower: Number(position.tickLower),
                tickUpper: Number(position.tickUpper),
                liquidity: JSBI.BigInt(position.liquidity)
              });
              
              const calculatedAmount0_JSBI = v4Position.amount0.quotient;
              const calculatedAmount1_JSBI = v4Position.amount1.quotient;

              const amount0BigInt = BigInt(calculatedAmount0_JSBI.toString());
              const amount1BigInt = BigInt(calculatedAmount1_JSBI.toString());
              
              const numericAmount0 = Number(amount0BigInt) / Number(token0Divisor);
              const numericAmount1 = Number(amount1BigInt) / Number(token1Divisor);
              
              const formattedAmount0 = viemFormatUnits(amount0BigInt, token0Decimals);
              const formattedAmount1 = viemFormatUnits(amount1BigInt, token1Decimals);
              
              // Convert everything to amount0 equivalent using current price
              let unifiedValue = numericAmount0;
              if (hasValidPrice && numericAmount1 > 0) {
                unifiedValue += numericAmount1 / priceNum;
              }

              processed.push({
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                liquidity: position.liquidity,
                amount0: formattedAmount0,
                amount1: formattedAmount1,
                numericAmount0,
                numericAmount1,
                unifiedValueInToken0: unifiedValue
              });
            } catch (error) {
              // Skip invalid positions
            }
          }
        }
        
        setProcessedPositions(processed);
      } catch (error) {
        console.error("[InteractiveRangeChart] Error processing positions:", error);
        setProcessedPositions(null);
      }
    } else {
      setProcessedPositions(null);
    }
  }, [rawHookPositions, currentPoolTick, currentPoolSqrtPriceX96, token0Symbol, token1Symbol, chainId, poolToken0, poolToken1, currentPrice, defaultTickSpacing]);

  // Calculate net liquidity by tick (Uniswap V4 style)
  useEffect(() => {
    if (processedPositions && processedPositions.length > 0) {
      const netLiquidityMap = new Map<number, number>();
      
      for (const position of processedPositions) {
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;
        const liquidity = position.unifiedValueInToken0;
        
        // Add liquidity at tickLower (position opens)
        const currentLowerLiquidity = netLiquidityMap.get(tickLower) || 0;
        netLiquidityMap.set(tickLower, currentLowerLiquidity + liquidity);
        
        // Subtract liquidity at tickUpper (position closes)
        const currentUpperLiquidity = netLiquidityMap.get(tickUpper) || 0;
        netLiquidityMap.set(tickUpper, currentUpperLiquidity - liquidity);
      }
      
      setNetLiquidityByTick(netLiquidityMap);
    } else {
      setNetLiquidityByTick(new Map());
    }
  }, [processedPositions]);



  // Axis is flipped whenever denomination is flipped
  const isAxisFlipped = useMemo(() => shouldFlipDenomination, [shouldFlipDenomination]);

  // Generate custom x-axis ticks for the preview chart using optimal denomination (simplified to 3 labels)
  const previewXAxisTicks = useMemo(() => {
    const newLabels: CustomAxisLabel[] = [];
    const minTickDomain = xDomain[0];
    const maxTickDomain = xDomain[1];

    if (poolToken0 && poolToken1 && optimalDenomination && currentPoolTick !== null) {
      if (isFinite(minTickDomain) && isFinite(maxTickDomain)) {
        const basePrice = normalizedCurrentPriceNum;
        if (!isFinite(basePrice) || basePrice <= 0) return newLabels;
        const displayDecimals = 6;
        
        // For USD-denominated tokens show more precision (6 decimals) only for Stable pools
        const isUsd = (optimalDenomination === 'aUSDT' || optimalDenomination === 'aUSDC');
        const finalDisplayDecimals = (isStablePool && isUsd) ? 6 : displayDecimals;
        
        // Calculate prices for left border, center (middle of visible range), and right border
        const middleTickDomain = (minTickDomain + maxTickDomain) / 2;
        const tickPositions = [minTickDomain, middleTickDomain, maxTickDomain];
        const pricePoints: { tick: number; price: number }[] = [];
        
        for (const tickVal of tickPositions) {
          const delta = tickVal - currentPoolTick;
          // Calculate price - use inverted calculation when flipped but keep normal tick order
          const priceAtTick = basePrice * Math.pow(1.0001, shouldFlipDenomination ? -delta : delta);
          if (!isNaN(priceAtTick)) pricePoints.push({ tick: tickVal, price: priceAtTick });
        }
        
        // Sort price points by tick position (left to right) but show prices in ascending order
        pricePoints.sort((a, b) => a.tick - b.tick);
        
        // If flipped, the prices will be descending by tick, so we need to reverse the labels
        // to show ascending prices from left to right
        if (shouldFlipDenomination) {
          // Reverse the price labels but keep the tick positions
          const reversedPrices = [...pricePoints].map(p => p.price).reverse();
          pricePoints.forEach((point, index) => {
            point.price = reversedPrices[index];
          });
        }
        
        // Create 3 labels: left border, center, right border
        for (const pricePoint of pricePoints) {
          let displayLabel: string;
          if (pricePoint.price > 0 && pricePoint.price < 0.01) {
            displayLabel = '<0.01';
          } else {
            const formatted = pricePoint.price.toLocaleString('en-US', { 
              maximumFractionDigits: finalDisplayDecimals, 
              minimumFractionDigits: Math.min(2, finalDisplayDecimals) 
            });
            // If it rounds to 0.00 but is actually positive, show <0.01
            displayLabel = (formatted === '0.00' && pricePoint.price > 0) ? '<0.01' : formatted;
          }
          
          newLabels.push({ 
            tickValue: transformTickToDisplay(pricePoint.tick), 
            displayLabel
          });
        }
      }
    }
    return newLabels;
  }, [xDomain, optimalDenomination, token0Symbol, token1Symbol, poolToken0, poolToken1, currentPoolTick, shouldFlipDenomination, normalizedCurrentPriceNum, isStablePool, transformTickToDisplay]);

  // Generate cumulative liquidity chart data from net liquidity by tick
  const liquidityChartData = useMemo(() => {
    if (netLiquidityByTick.size === 0) return [];
    
    // Get all ticks and sort them
    const sortedTicks = Array.from(netLiquidityByTick.keys()).sort((a, b) => a - b);
    
    // Filter to visible range for performance using original domain
    const [minTick, maxTick] = xDomain;
    const buffer = Math.max((maxTick - minTick) * 0.2, defaultTickSpacing * 50); // 20% buffer or at least 50 tick spacings
    const visibleTicks = sortedTicks.filter(tick => 
      tick >= minTick - buffer && tick <= maxTick + buffer
    );
    
    // Calculate cumulative liquidity starting from the earliest tick
    const chartData: Array<{ tick: number; liquidity: number }> = [];
    let cumulativeLiquidity = 0;
    
    // Calculate baseline cumulative liquidity from all ticks before our visible range
    if (visibleTicks.length > 0) {
      for (const tick of sortedTicks) {
        if (tick < visibleTicks[0]) {
          cumulativeLiquidity += netLiquidityByTick.get(tick) || 0;
        } else {
          break;
        }
      }
    }
    


    // Process visible ticks with correct cumulative baseline
    for (const tick of visibleTicks) {
      const netChange = netLiquidityByTick.get(tick) || 0;
      cumulativeLiquidity += netChange;
      
      // Add data point with display-space positioning
      chartData.push({
        tick: transformTickToDisplay(tick),
        liquidity: Math.max(0, cumulativeLiquidity) // Ensure non-negative
      });
    }
    
    // Ensure at least two points exist at the domain bounds so the area renders even when zoomed tightly
    const [displayMin, displayMax] = displayDomain;
    if (chartData.length === 0) {
      // If no liquidity data in range, show baseline from the cumulative calculation
      return [
        { tick: displayMin, liquidity: Math.max(0, cumulativeLiquidity) },
        { tick: displayMax, liquidity: Math.max(0, cumulativeLiquidity) }
      ];
    }
    
    // Sort chart data by display tick for proper rendering
    chartData.sort((a, b) => a.tick - b.tick);
    
    if (chartData[0].tick > displayMin) {
      chartData.unshift({ tick: displayMin, liquidity: chartData[0].liquidity });
    }
    if (chartData[chartData.length - 1].tick < displayMax) {
      chartData.push({ tick: displayMax, liquidity: chartData[chartData.length - 1].liquidity });
    }
    
    return chartData;
  }, [netLiquidityByTick, xDomain, defaultTickSpacing, transformTickToDisplay, displayDomain]);

  // Calculate max liquidity for chart scaling
  const maxLiquidity = useMemo(() => {
    if (liquidityChartData.length === 0) return 1;
    const maxVal = Math.max(...liquidityChartData.map(d => d.liquidity));
    if (maxVal === 0) return 1;
    return maxVal * 1.1; // Add 10% padding at top
  }, [liquidityChartData]);

  // Calculate positions based on display dimensions
  const getDisplayPosition = (displayTick: number) => {
    const [displayMin, displayMax] = displayDomain;
    const displayRange = displayMax - displayMin;
    const position = ((displayTick - displayMin) / displayRange) * 100;
    return Math.max(0, Math.min(100, position));
  };

  // Calculate visual positions for drag handles using display coordinates
  const displayTickLower = transformTickToDisplay(Number(tickLower));
  const displayTickUpper = transformTickToDisplay(Number(tickUpper));
  
  // In display space, we always want left handle at lower display value, right at higher
  const leftPos = getDisplayPosition(Math.min(displayTickLower, displayTickUpper));
  const rightPos = getDisplayPosition(Math.max(displayTickLower, displayTickUpper));
  
  // Track which underlying tick corresponds to which visual position
  const leftIsLower = displayTickLower <= displayTickUpper;

  const handleMouseDown = (e: React.MouseEvent, side: 'left' | 'right' | 'center') => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(side);
    if (onDragStateChange) onDragStateChange(side);
    setDragStart({
      x: e.clientX,
      tickLower: parseInt(tickLower),
      tickUpper: parseInt(tickUpper)
    });
  };

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (isDragging || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setIsPanningViewport(true);
    panViewportStartRef.current = { x: e.clientX, domain: [...xDomain] as [number, number] };
  };

  // Simple helper to align ticks to spacing
  const alignToTickSpacing = (tick: number): number => {
    return Math.round(tick / defaultTickSpacing) * defaultTickSpacing;
  };

  const handleBackgroundMouseMove = (e: MouseEvent) => {
    if (!isPanningViewport || !panViewportStartRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - panViewportStartRef.current.x;
    const [minTick, maxTick] = panViewportStartRef.current.domain;
    const domainSize = maxTick - minTick;
    
    // Calculate delta in tick space (always work in underlying tick space for panning)
    let deltaTicks = (dx / rect.width) * domainSize;
    
    // When inverted, we want visual panning to work intuitively (left moves left in display)
    // So we need to invert the delta when the display is flipped
    if (shouldFlipDenomination) {
      deltaTicks = -deltaTicks;
    }
    
    const newMin = alignToTickSpacing(minTick - deltaTicks);
    const newMax = alignToTickSpacing(maxTick - deltaTicks);
    scheduleXDomainChange([newMin, newMax]);
  };

  const stopBackgroundPan = () => {
    if (isPanningViewport) {
      setIsPanningViewport(false);
      panViewportStartRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent, side: 'left' | 'right' | 'center') => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    setIsDragging(side);
    if (onDragStateChange) onDragStateChange(side);
    setDragStart({
      x: touch.clientX,
      tickLower: parseInt(tickLower),
      tickUpper: parseInt(tickUpper)
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragStart || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = e.clientX - dragStart.x;
    const containerWidth = rect.width;
    const [displayMin, displayMax] = displayDomain;
    const displayRange = displayMax - displayMin;
    const deltaDisplayTicks = (deltaX / containerWidth) * displayRange;

    // Convert current ticks to display space for manipulation
    const startDisplayLower = transformTickToDisplay(dragStart.tickLower);
    const startDisplayUpper = transformTickToDisplay(dragStart.tickUpper);
    
    let newDisplayLower = startDisplayLower;
    let newDisplayUpper = startDisplayUpper;

    // Work in display space - left handle controls left display boundary, right controls right
    const leftDisplayTick = Math.min(startDisplayLower, startDisplayUpper);
    const rightDisplayTick = Math.max(startDisplayLower, startDisplayUpper);
    const isLowerOnLeft = startDisplayLower <= startDisplayUpper;

    if (isDragging === 'left') {
      const newLeftDisplay = leftDisplayTick + deltaDisplayTicks;
      if (isLowerOnLeft) {
        newDisplayLower = Math.min(rightDisplayTick - defaultTickSpacing, newLeftDisplay);
      } else {
        newDisplayUpper = Math.min(rightDisplayTick - defaultTickSpacing, newLeftDisplay);
      }
    } else if (isDragging === 'right') {
      const newRightDisplay = rightDisplayTick + deltaDisplayTicks;
      if (isLowerOnLeft) {
        newDisplayUpper = Math.max(leftDisplayTick + defaultTickSpacing, newRightDisplay);
      } else {
        newDisplayLower = Math.max(leftDisplayTick + defaultTickSpacing, newRightDisplay);
      }
    } else if (isDragging === 'center') {
      // Center drag moves both boundaries together in display space
      newDisplayLower = startDisplayLower + deltaDisplayTicks;
      newDisplayUpper = startDisplayUpper + deltaDisplayTicks;
      
      // Constrain to display bounds
      if (Math.min(newDisplayLower, newDisplayUpper) < displayMin) {
        const adjustment = displayMin - Math.min(newDisplayLower, newDisplayUpper);
        newDisplayLower += adjustment;
        newDisplayUpper += adjustment;
      }
      if (Math.max(newDisplayLower, newDisplayUpper) > displayMax) {
        const adjustment = Math.max(newDisplayLower, newDisplayUpper) - displayMax;
        newDisplayLower -= adjustment;
        newDisplayUpper -= adjustment;
      }
    }

    // Convert back to tick space
    let newTickLower = transformDisplayToTick(newDisplayLower);
    let newTickUpper = transformDisplayToTick(newDisplayUpper);

    // Ensure proper order in tick space
    if (newTickLower > newTickUpper) {
      [newTickLower, newTickUpper] = [newTickUpper, newTickLower];
    }

    // CRITICAL: Snap to valid tick spacing during drag for smooth, aligned movement
    newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
    newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

    // Apply tick space constraints AFTER snapping
    newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
    newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

    // Ensure minimum spacing in tick space
    if (newTickUpper - newTickLower < defaultTickSpacing) {
      const center = (newTickLower + newTickUpper) / 2;
      newTickLower = Math.round((center - defaultTickSpacing / 2) / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = newTickLower + defaultTickSpacing;
      // Reapply constraints after spacing adjustment
      newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick - defaultTickSpacing, newTickLower));
      newTickUpper = Math.min(sdkMaxTick, Math.max(sdkMinTick + defaultTickSpacing, newTickUpper));
    }

    scheduleRangeChange(newTickLower.toString(), newTickUpper.toString());
    
    finalDragPositionRef.current = { 
      tickLower: newTickLower, 
      tickUpper: newTickUpper,
      hitRightEdge: false,
      hitLeftEdge: false
    };
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging || !dragStart || !containerRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = touch.clientX - dragStart.x;
    const containerWidth = rect.width;
    const [displayMin, displayMax] = displayDomain;
    const displayRange = displayMax - displayMin;
    const deltaDisplayTicks = (deltaX / containerWidth) * displayRange;

    // Get start positions in display space
    const startDisplayLower = transformTickToDisplay(dragStart.tickLower);
    const startDisplayUpper = transformTickToDisplay(dragStart.tickUpper);
    
    let newDisplayLower = startDisplayLower;
    let newDisplayUpper = startDisplayUpper;

    // Work in display space - left handle controls left display boundary, right controls right
    const leftDisplayTick = Math.min(startDisplayLower, startDisplayUpper);
    const rightDisplayTick = Math.max(startDisplayLower, startDisplayUpper);
    const isLowerOnLeft = startDisplayLower <= startDisplayUpper;

    if (isDragging === 'left') {
      const newLeftDisplay = leftDisplayTick + deltaDisplayTicks;
      if (isLowerOnLeft) {
        newDisplayLower = Math.min(rightDisplayTick - defaultTickSpacing, newLeftDisplay);
      } else {
        newDisplayUpper = Math.min(rightDisplayTick - defaultTickSpacing, newLeftDisplay);
      }
    } else if (isDragging === 'right') {
      const newRightDisplay = rightDisplayTick + deltaDisplayTicks;
      if (isLowerOnLeft) {
        newDisplayUpper = Math.max(leftDisplayTick + defaultTickSpacing, newRightDisplay);
      } else {
        newDisplayLower = Math.max(leftDisplayTick + defaultTickSpacing, newRightDisplay);
      }
    } else if (isDragging === 'center') {
      // Center drag moves both boundaries together in display space
      newDisplayLower = startDisplayLower + deltaDisplayTicks;
      newDisplayUpper = startDisplayUpper + deltaDisplayTicks;
      
      // Constrain to display bounds
      if (Math.min(newDisplayLower, newDisplayUpper) < displayMin) {
        const adjustment = displayMin - Math.min(newDisplayLower, newDisplayUpper);
        newDisplayLower += adjustment;
        newDisplayUpper += adjustment;
      }
      if (Math.max(newDisplayLower, newDisplayUpper) > displayMax) {
        const adjustment = Math.max(newDisplayLower, newDisplayUpper) - displayMax;
        newDisplayLower -= adjustment;
        newDisplayUpper -= adjustment;
      }
    }

    // Convert back to tick space
    let newTickLower = transformDisplayToTick(newDisplayLower);
    let newTickUpper = transformDisplayToTick(newDisplayUpper);

    // Ensure proper order in tick space
    if (newTickLower > newTickUpper) {
      [newTickLower, newTickUpper] = [newTickUpper, newTickLower];
    }

    // CRITICAL: Snap to valid tick spacing during drag for smooth, aligned movement
    newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
    newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

    // Apply tick space constraints AFTER snapping
    newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
    newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

    // Ensure minimum spacing in tick space
    if (newTickUpper - newTickLower < defaultTickSpacing) {
      const center = (newTickLower + newTickUpper) / 2;
      newTickLower = Math.round((center - defaultTickSpacing / 2) / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = newTickLower + defaultTickSpacing;
      // Reapply constraints after spacing adjustment
      newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick - defaultTickSpacing, newTickLower));
      newTickUpper = Math.min(sdkMaxTick, Math.max(sdkMinTick + defaultTickSpacing, newTickUpper));
    }

    scheduleRangeChange(newTickLower.toString(), newTickUpper.toString());
    
    finalDragPositionRef.current = { 
      tickLower: newTickLower, 
      tickUpper: newTickUpper,
      hitRightEdge: false,
      hitLeftEdge: false
    };
  };

  const handleMouseUp = () => {
    if (finalDragPositionRef.current) {
      const { tickLower: finalTickLower, tickUpper: finalTickUpper } = finalDragPositionRef.current;

      // Snap to valid tick spacing
      let snapLower = Math.round(finalTickLower / defaultTickSpacing) * defaultTickSpacing;
      let snapUpper = Math.round(finalTickUpper / defaultTickSpacing) * defaultTickSpacing;
      
      // Ensure minimum spacing
      if (snapUpper - snapLower < defaultTickSpacing) {
        const center = (snapLower + snapUpper) / 2;
        snapLower = Math.round((center - defaultTickSpacing / 2) / defaultTickSpacing) * defaultTickSpacing;
        snapUpper = snapLower + defaultTickSpacing;
      }
      
      // Apply constraints - clamp to sdk bounds
      snapLower = Math.max(sdkMinTick, Math.min(sdkMaxTick - defaultTickSpacing, snapLower));
      snapUpper = Math.min(sdkMaxTick, Math.max(sdkMinTick + defaultTickSpacing, snapUpper));
      
      // Final validation: ensure they're still aligned to tick spacing after constraints
      snapLower = Math.round(snapLower / defaultTickSpacing) * defaultTickSpacing;
      snapUpper = Math.round(snapUpper / defaultTickSpacing) * defaultTickSpacing;
      
      onRangeChange(String(snapLower), String(snapUpper));
    }

    setIsDragging(null);
    if (onDragStateChange) onDragStateChange(null);
    setDragStart(null);
    finalDragPositionRef.current = null;
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchEnd);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
      };
    }
  }, [isDragging, dragStart]);

  useEffect(() => {
    if (isPanningViewport) {
      document.addEventListener('mousemove', handleBackgroundMouseMove);
      document.addEventListener('mouseup', stopBackgroundPan);
      return () => {
        document.removeEventListener('mousemove', handleBackgroundMouseMove);
        document.removeEventListener('mouseup', stopBackgroundPan);
      };
    }
  }, [isPanningViewport]);

  const zoomByFactor = (factor: number) => {
    const [minTick, maxTick] = xDomain;
    const center = (minTick + maxTick) / 2;
    const half = (maxTick - minTick) / 2;
    const newHalf = half * factor;
    const newMin = alignToTickSpacing(center - newHalf);
    const newMax = alignToTickSpacing(center + newHalf);
    if (onXDomainChange) onXDomainChange([newMin, newMax]);
  };

  const centerOnCurrentPrice = () => {
    if (currentPoolTick === null) return;
    // Set viewport based on pool type: ±5% for stable, ±20% for volatile
    const percentageRange = isStablePool ? 0.05 : 0.20;
    const tickRange = Math.round(Math.log(1 + percentageRange) / Math.log(1.0001));
    const newMin = alignToTickSpacing(currentPoolTick - tickRange);
    const newMax = alignToTickSpacing(currentPoolTick + tickRange);
    if (onXDomainChange) onXDomainChange([newMin, newMax]);
  };

  return (
    <div className="h-full w-full min-h-[80px] flex flex-col">
      <div
        className={`relative flex-1 w-full min-h-[60px] ${readOnly ? '' : 'touch-manipulation'}`}
        ref={containerRef}
        onMouseEnter={() => !readOnly && setIsHovering(true)}
        onMouseLeave={() => { !readOnly && setIsHovering(false); !readOnly && stopBackgroundPan(); }}
        onMouseDown={readOnly ? undefined : handleBackgroundMouseDown}
        onTouchStart={readOnly ? undefined : (e) => {
          if (e.touches.length === 1) {
            e.preventDefault();
          }
        }}
      >
        {/* Chart */}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={liquidityChartData.length > 0 ? liquidityChartData : [{ tick: displayDomain[0], liquidity: 0 }, { tick: displayDomain[1], liquidity: 0 }]}
            margin={{ top: 2, right: 5, bottom: 4, left: 5 }}
          >
            <RechartsTooltip cursor={false} content={() => null} />
            <XAxis 
              dataKey="tick" 
              type="number" 
              domain={displayDomain} 
              allowDataOverflow 
              tick={false}
              axisLine={false}
              height={1}
              tickMargin={0} 
            />
            <YAxis 
              hide={true}
              yAxisId="bucketAxis" 
              orientation="right"
              type="number"
              domain={[0, maxLiquidity]}
              allowDecimals={true}
            />
            
            {/* Step area chart for liquidity depth - direction changes based on denomination */}
            <Area
              yAxisId="bucketAxis"
              type={shouldFlipDenomination ? "stepBefore" : "stepAfter"}
              dataKey="liquidity"
              stroke="none"
              fill="#404040"
              fillOpacity={0.4}
              isAnimationActive={false}
              connectNulls={false}
              dot={false}
              activeDot={false}
            />
            
            {/* Current price line */}
            {currentPoolTick !== null && !isChartDataLoading && (
              <ReferenceLine 
                x={transformTickToDisplay(currentPoolTick)} 
                stroke="#e85102"
                strokeWidth={1.5} 
                ifOverflow="extendDomain"
                yAxisId="bucketAxis"
              />
            )}
            
            {/* Selected range indicator */}
            {!isNaN(parseInt(tickLower)) && !isNaN(parseInt(tickUpper)) && !isChartDataLoading && (
              <ReferenceArea
                x1={transformTickToDisplay(parseInt(tickLower))}
                x2={transformTickToDisplay(parseInt(tickUpper))}
                yAxisId="bucketAxis"
                strokeOpacity={0}
                fill="#e85102"
                fillOpacity={0.3}
                ifOverflow="extendDomain"
              />
            )}

          </ComposedChart>
        </ResponsiveContainer>

        {/* Static drag handles - hidden during loading */}
        {!readOnly && !isChartDataLoading && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Invisible center area - drag to move entire range */}
            <div
              className="absolute top-0 bottom-0 pointer-events-auto cursor-move"
              style={{
                left: `${leftPos}%`,
                width: `${rightPos - leftPos}%`
              }}
              onMouseDown={(e) => handleMouseDown(e, 'center')}
              onTouchStart={(e) => handleTouchStart(e, 'center')}
            />

            {/* Left handle */}
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${leftPos}%`,
                top: '2px',
                bottom: '5px',
                width: '20px'
              }}
              onMouseDown={(e) => handleMouseDown(e, 'left')}
              onTouchStart={(e) => handleTouchStart(e, 'left')}
            >
              {/* Center grip bars - covers the line in middle section */}
              <div className="absolute top-1/2 -translate-y-1/2 z-10 flex h-8 w-4 items-center justify-center rounded-sm bg-white/60 hover:bg-white/80 transition-colors gap-1" style={{ left: '-7px' }}>
                <div className="w-0.5 h-4 bg-black/40 rounded-full"></div>
                <div className="w-0.5 h-4 bg-black/40 rounded-full"></div>
              </div>
              {/* Solid edge line - split into two parts to avoid showing under grip bar */}
              <div className="absolute left-0 top-0 w-0.5 bg-white/60 transition-colors" style={{ bottom: 'calc(50% + 16px)' }}></div>
              <div className="absolute left-0 bottom-0 w-0.5 bg-white/60 transition-colors" style={{ top: 'calc(50% + 16px)' }}></div>
            </div>

            {/* Right handle */}
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${rightPos}%`,
                top: '2px',
                bottom: '5px',
                width: '20px',
                transform: 'translateX(-100%)'
              }}
              onMouseDown={(e) => handleMouseDown(e, 'right')}
              onTouchStart={(e) => handleTouchStart(e, 'right')}
            >
              {/* Center grip bars - covers the line in middle section */}
              <div className="absolute top-1/2 -translate-y-1/2 z-10 flex h-8 w-4 items-center justify-center rounded-sm bg-white/60 hover:bg-white/80 transition-colors gap-1" style={{ right: '-7px' }}>
                <div className="w-0.5 h-4 bg-black/40 rounded-full"></div>
                <div className="w-0.5 h-4 bg-black/40 rounded-full"></div>
              </div>
              {/* Solid edge line - split into two parts to avoid showing under grip bar */}
              <div className="absolute right-0 top-0 w-0.5 bg-white/60 transition-colors" style={{ bottom: 'calc(50% + 16px)' }}></div>
              <div className="absolute right-0 bottom-0 w-0.5 bg-white/60 transition-colors" style={{ top: 'calc(50% + 16px)' }}></div>
            </div>
          </div>
        )}

        {/* Hover-only zoom controls */}
        {!readOnly && (
          <div className={`absolute top-1 right-1 flex gap-1 pointer-events-auto transition-opacity duration-200 ${isHovering ? 'opacity-100' : 'opacity-0'}`}>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-button hover:brightness-110 hover:border-white/30"
            onClick={() => zoomByFactor(0.8)}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-button hover:brightness-110 hover:border-white/30"
            onClick={() => zoomByFactor(1.25)}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-button hover:brightness-110 hover:border-white/30"
            onClick={centerOnCurrentPrice}
            aria-label="Center on current price"
          >
            <Maximize className="h-4 w-4" />
          </button>
          {onReset && (
            <button
              type="button"
              className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-button hover:brightness-110 hover:border-white/30"
              onClick={onReset}
              aria-label="Reset range"
            >
              <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true" className="opacity-80">
                <path d="M2 6C2 3.79086 3.79086 2 6 2C7.38071 2 8.61929 2.65929 9.36396 3.68342M10 6C10 8.20914 8.20914 10 6 10C4.61929 10 3.38071 9.34071 2.63604 8.31658M9.5 2V4H7.5M2.5 10V8H4.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          </div>
        )}
      </div>

      {/* Custom X-Axis Labels for Preview (using optimal denomination) */}
      {!isChartDataLoading && (
        <div className="flex justify-between w-full px-[5px] box-border pt-0.5 flex-shrink-0">
          {previewXAxisTicks.map((labelItem, index) => (
            <span key={index} className="text-xs text-muted-foreground">
              {labelItem.displayLabel}
            </span>
          ))}
        </div>
      )}
    </div>
  );
} 