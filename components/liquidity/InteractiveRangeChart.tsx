"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Area, ReferenceLine, ReferenceArea, Tooltip as RechartsTooltip } from "recharts";
import { ChevronLeft, ChevronRight, PlusIcon, MinusIcon, CrosshairIcon } from "lucide-react";
import { toast } from "sonner";
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

interface DepthChartDataPoint {
  tick: number;
  token0Depth: number;
  normToken0Depth?: number;
  token1Depth?: number;
  unifiedValue?: number;
  normUnifiedValue?: number;
  isUserPosition?: boolean;
  price?: number;
  value?: number;
  cumulativeUnifiedValue?: number;
  displayCumulativeValue?: number;
  liquidityToken0?: number;
  bucketWidth?: number;
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
}

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

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
  onDragStateChange
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

  // Chart data state
  const [rawHookPositions, setRawHookPositions] = useState<Array<HookPosition & { pool: string }> | null>(null);
  const [processedPositions, setProcessedPositions] = useState<ProcessedPositionDetail[] | null>(null);
  const [bucketLiquidityData, setBucketLiquidityData] = useState<BucketData[]>([]);
  const [isFetchingLiquidityDepth, setIsFetchingLiquidityDepth] = useState(false);
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

  // Helper function to determine the better base token for price display (same logic as AddLiquidityModal)
  const determineBaseTokenForPriceDisplay = useCallback((token0: TokenSymbol, token1: TokenSymbol): TokenSymbol => {
    if (!token0 || !token1) return token0;

    // Priority order for quote tokens (these should be the base for price display)
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

    // Return the token with higher priority (better quote currency)
    // If priorities are equal, default to token0
    return token1Priority > token0Priority ? token1 : token0;
  }, []);

  // Determine optimal denomination for price display
  const optimalDenomination = useMemo(() => {
    if (!token0Symbol || !token1Symbol) return token0Symbol;
    return determineBaseTokenForPriceDisplay(token0Symbol, token1Symbol);
  }, [token0Symbol, token1Symbol, determineBaseTokenForPriceDisplay]);

  // Determine if we need to flip the denomination to show higher prices
  const shouldFlipDenomination = useMemo(() => {
    if (!currentPrice || !token0Symbol || !token1Symbol) return false;
    
    const currentPriceNum = parseFloat(currentPrice);
    const inversePrice = 1 / currentPriceNum;
    
    // If the inverse price is larger, we should flip the denomination
    return inversePrice > currentPriceNum;
  }, [currentPrice, token0Symbol, token1Symbol]);

  // Derive on-chain pool ID
  const getDerivedOnChainPoolId = useCallback(() => {
    if (!token0Symbol || !token1Symbol || !chainId || !selectedPoolId) {
      return null;
    }

    try {
      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];
      
      if (!token0Def || !token1Def) {
        return null;
      }

      // Create sorted tokens for pool ID calculation
      const sdkBaseToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
      const sdkBaseToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);
      const [sdkSortedToken0, sdkSortedToken1] = sdkBaseToken0.sortsBefore(sdkBaseToken1) 
          ? [sdkBaseToken0, sdkBaseToken1] 
          : [sdkBaseToken1, sdkBaseToken0];

      // Use the actual pool configuration values
      const poolConfig = {
        fee: 3000, // Default fee
        tickSpacing: defaultTickSpacing,
        hooks: "0x0000000000000000000000000000000000000000" as Hex
      };

      // Calculate pool ID using the same logic as the API
      const poolIdBytes32 = V4PoolSDK.getPoolId(
        sdkSortedToken0,
        sdkSortedToken1,
        poolConfig.fee, 
        poolConfig.tickSpacing, 
        poolConfig.hooks
      );
      
      return poolIdBytes32.toLowerCase();
    } catch (error) {
      console.error("[InteractiveRangeChart] Error deriving on-chain pool ID:", error);
      return null;
    }
  }, [token0Symbol, token1Symbol, chainId, selectedPoolId, defaultTickSpacing]);

  // Fetch liquidity depth data
  useEffect(() => {
    const fetchLiquidityDepthData = async () => {
      console.log("[DEBUG] Fetching liquidity depth data with params:", { selectedPoolId, chainId, currentPoolTick });
      if (!selectedPoolId || !chainId || currentPoolTick === null) {
        console.log("[DEBUG] Missing required params for liquidity depth fetch");
        setRawHookPositions(null);
        return;
      }

      // Use selectedPoolId directly instead of deriving a new one
      const poolIdToSearch = getSubgraphIdFromPoolId(selectedPoolId);
      console.log("[DEBUG] Using pool ID directly:", poolIdToSearch);
      if (!poolIdToSearch) {
        console.warn("[InteractiveRangeChart] Could not find subgraphId for pool ID:", selectedPoolId);
        setRawHookPositions(null);
        return;
      }

      setIsFetchingLiquidityDepth(true);
      setIsChartDataLoading(true);

      try {
        const graphqlQuery = {
          query: `
            query GetAllHookPositionsForDepth {
              hookPositions(first: 1000, orderBy: liquidity, orderDirection: desc) {
                pool
                tickLower
                tickUpper
                liquidity
              }
            }
          `,
        };

        const queryPayload = { query: graphqlQuery.query };

        console.log("[InteractiveRangeChart] Fetching from subgraph...");
        const response = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(queryPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Network response was not ok: ${response.status} ${response.statusText}. Details: ${errorText}`);
        }

        const result = await response.json();
        console.log("[InteractiveRangeChart] Subgraph response:", result);

        if (result.errors) {
          console.error("[InteractiveRangeChart] GraphQL errors from subgraph:", result.errors);
          throw new Error(`GraphQL error: ${result.errors.map((e: any) => e.message).join(', ')}`);
        }

        if (result.data && result.data.hookPositions) {
          const allFetchedPositions = result.data.hookPositions as Array<HookPosition & { pool: string }>; 
          console.log(`[InteractiveRangeChart] Subgraph returned ${allFetchedPositions.length} total hookPositions before client-side filtering.`);
          
          // Debug: Log a few sample positions to see the pool ID format
          if (allFetchedPositions.length > 0) {
            console.log("[InteractiveRangeChart] Sample positions from subgraph:", allFetchedPositions.slice(0, 3));
            console.log("[InteractiveRangeChart] Looking for pool ID:", poolIdToSearch);
            console.log("[InteractiveRangeChart] All pool IDs in subgraph:", allFetchedPositions.map(pos => pos.pool));
          }
          
          // Filter for exact pool match only
          const relevantPositions = allFetchedPositions.filter(
            pos => pos.pool && pos.pool.toLowerCase().trim() === poolIdToSearch.trim()
          );

          console.log(`[InteractiveRangeChart] Filtered to ${relevantPositions.length} relevant positions for pool ${poolIdToSearch}`);
          setRawHookPositions(relevantPositions);
        } else {
          setRawHookPositions([]);
          console.warn("[InteractiveRangeChart] No hookPositions found in GraphQL response or unexpected data structure.");
        }

      } catch (error: any) {
        console.error("[InteractiveRangeChart] Error fetching liquidity depth data:", error);
        // Don't show toast error for network issues, just use fallback data
        setRawHookPositions(null);
      } finally {
        setIsFetchingLiquidityDepth(false);
        setIsChartDataLoading(false);
      }
    };

    fetchLiquidityDepthData();
  }, [selectedPoolId, chainId, currentPoolTick, token0Symbol, token1Symbol]);

  // Process raw positions into processed positions with amounts
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

      // Find pool config
      const poolConfig = {
        fee: 3000, // Default fee, should be passed as prop
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

              const formattedAmount0 = viemFormatUnits(BigInt(calculatedAmount0_JSBI.toString()), poolToken0.decimals);
              const formattedAmount1 = viemFormatUnits(BigInt(calculatedAmount1_JSBI.toString()), poolToken1.decimals);
              
              const numericAmount0 = parseFloat(formattedAmount0);
              const numericAmount1 = parseFloat(formattedAmount1);
              
              let unifiedValue = numericAmount0;
              if (currentPrice && numericAmount1 > 0) {
                const price = parseFloat(currentPrice);
                if (!isNaN(price) && price > 0) {
                  unifiedValue += numericAmount1 * price;
                }
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
              // Silently skip invalid positions
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

  // Calculate tick buckets and generate bucket data
  const calculateTickBuckets = useCallback((tickLower: number, tickUpper: number, tickSpacing: number, bucketCount: number = 25) => {
    const range = tickUpper - tickLower;
    // Enforce a minimum visual bin width to avoid per-tick rendering for tiny spacings
    const MIN_VISUAL_BIN = 30; // ticks
    const minBin = Math.max(MIN_VISUAL_BIN, tickSpacing);

    const rawBucketSize = Math.max(range / bucketCount, tickSpacing);
    const targetBucketSize = Math.max(rawBucketSize, minBin);
    const alignedBucketSize = Math.ceil(targetBucketSize / tickSpacing) * tickSpacing;

    const buckets: { tickLower: number; tickUpper: number }[] = [];
    let currentTick = tickLower;

    while (currentTick < tickUpper) {
      const bucketUpper = Math.min(currentTick + alignedBucketSize, tickUpper);
      buckets.push({ tickLower: currentTick, tickUpper: bucketUpper });
      currentTick = bucketUpper;
    }

    return buckets;
  }, []);

  // Generate bucket liquidity data
  useEffect(() => {
    // Skip runtime logging during drag to improve performance
    
    if (processedPositions && processedPositions.length > 0) {
      // Build a stable liquidity profile across full positions span to avoid replot on pan/zoom
      const globalMin = Math.min(...processedPositions.map(p => p.tickLower));
      const globalMax = Math.max(...processedPositions.map(p => p.tickUpper));

      // Adaptive bucket count: aim for ~200 buckets, clamp, and enforce min visual bin
      const MIN_VISUAL_BIN = 30; // ticks
      const approxBuckets = Math.ceil((globalMax - globalMin) / Math.max(defaultTickSpacing, MIN_VISUAL_BIN));
      const targetBuckets = Math.max(60, Math.min(300, approxBuckets));
      const buckets = calculateTickBuckets(globalMin, globalMax, defaultTickSpacing, targetBuckets);

      // Fast aggregation using a difference-array over buckets (O(n + m))
      const nb = buckets.length;
      if (nb === 0) {
        setBucketLiquidityData([]);
        return;
      }
      const alignedBucketSize = buckets[0].tickUpper - buckets[0].tickLower;
      const diff = new Float64Array(nb + 1);

      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

      for (const position of processedPositions) {
        // Map position span to bucket index range (inclusive)
        const sTick = clamp(position.tickLower, globalMin, globalMax - 1);
        const eTick = clamp(position.tickUpper - 1, globalMin, globalMax - 1);
        if (eTick < sTick) continue;
        const s = clamp(Math.floor((sTick - globalMin) / alignedBucketSize), 0, nb - 1);
        const e = clamp(Math.floor((eTick - globalMin) / alignedBucketSize), 0, nb - 1);
        if (s <= e) {
          diff[s] += position.unifiedValueInToken0;
          diff[e + 1] -= position.unifiedValueInToken0;
        }
      }

      const bucketData: BucketData[] = new Array(nb);
      let running = 0;
      for (let i = 0; i < nb; i++) {
        running += diff[i];
        const b = buckets[i];
        bucketData[i] = {
          tickLower: b.tickLower,
          tickUpper: b.tickUpper,
          midTick: Math.floor((b.tickLower + b.tickUpper) / 2),
          liquidityToken0: running.toFixed(2),
        };
      }

      setBucketLiquidityData(bucketData);
    } else {
      setBucketLiquidityData([]);
    }
  }, [processedPositions, defaultTickSpacing, calculateTickBuckets]);

  // Calculate if axis should be flipped based on price order
  const isAxisFlipped = useMemo(() => {
    if (!currentPoolTick || !currentPrice || !optimalDenomination || !token0Symbol || bucketLiquidityData.length < 2) {
      return false;
    }
    
    const currentPriceNum = parseFloat(currentPrice);
    
    const tickSortedBuckets = [...bucketLiquidityData].sort((a, b) => a.midTick - b.midTick);
    const firstByTick = tickSortedBuckets[0];
    const secondByTick = tickSortedBuckets[1];
    
    // Avoid logging during drag
    
    const firstDelta = Math.pow(1.0001, firstByTick.midTick - currentPoolTick);
    const secondDelta = Math.pow(1.0001, secondByTick.midTick - currentPoolTick);
    
    let firstPrice, secondPrice;
    if (shouldFlipDenomination) {
      // Use inverse prices for comparison
      firstPrice = 1 / (currentPriceNum * firstDelta);
      secondPrice = 1 / (currentPriceNum * secondDelta);
    } else {
      // Use direct prices for comparison
      firstPrice = currentPriceNum * firstDelta;
      secondPrice = currentPriceNum * secondDelta;
    }
    
    const shouldFlip = firstPrice > secondPrice;
    // Avoid logging during drag
    
    return shouldFlip;
  }, [currentPoolTick, currentPrice, optimalDenomination, token0Symbol, bucketLiquidityData, shouldFlipDenomination]);

  // Generate custom x-axis ticks for the preview chart using optimal denomination (simplified to 3 labels)
  const previewXAxisTicks = useMemo(() => {
    const newLabels: CustomAxisLabel[] = [];
    const minTickDomain = xDomain[0];
    const maxTickDomain = xDomain[1];

    if (poolToken0 && poolToken1 && optimalDenomination && currentPoolTick !== null && currentPrice) {
      if (isFinite(minTickDomain) && isFinite(maxTickDomain)) {
        const currentPriceNum = parseFloat(currentPrice);
        const displayDecimals = TOKEN_DEFINITIONS[optimalDenomination]?.displayDecimals || 4;
        
        // For USD-denominated tokens, always use 2 decimals
        const finalDisplayDecimals = (optimalDenomination === 'aUSDT' || optimalDenomination === 'aUSDC') ? 2 : displayDecimals;
        
        // Calculate prices for left border, center (middle of visible range), and right border
        const middleTickDomain = (minTickDomain + maxTickDomain) / 2;
        const tickPositions = [minTickDomain, middleTickDomain, maxTickDomain];
        const pricePoints: { tick: number; price: number }[] = [];
        
        for (const tickVal of tickPositions) {
          const priceDelta = Math.pow(1.0001, tickVal - currentPoolTick);
          
          let priceAtTick = NaN;
          if (shouldFlipDenomination) {
            // Show the inverse price (higher denomination)
            priceAtTick = 1 / (currentPriceNum * priceDelta);
          } else {
            // Show the direct price (higher denomination)
            priceAtTick = currentPriceNum * priceDelta;
          }

          // Avoid logging during drag

          if (!isNaN(priceAtTick)) {
            pricePoints.push({ tick: tickVal, price: priceAtTick });
          }
        }
        
        // Sort price points by price (ascending) to get the desired price order
        pricePoints.sort((a, b) => a.price - b.price);
        
        // When axis is flipped, the chart data is reversed, so we need to reverse the labels
        // to maintain the correct visual order (left to right = ascending price)
        if (isAxisFlipped) {
          // Chart data is reversed, so labels should also be reversed to match visual order
          pricePoints.reverse();
        }
        
        // Create 3 labels: left border, center, right border
        for (const pricePoint of pricePoints) {
          const displayLabel = pricePoint.price.toLocaleString('en-US', { 
            maximumFractionDigits: finalDisplayDecimals, 
            minimumFractionDigits: Math.min(2, finalDisplayDecimals) 
          });
          
          newLabels.push({ 
            tickValue: pricePoint.tick, 
            displayLabel
          });
        }
      }
    }
    return newLabels;
  }, [xDomain, optimalDenomination, token0Symbol, token1Symbol, poolToken0, poolToken1, currentPoolTick, currentPrice, isAxisFlipped, shouldFlipDenomination]);

  // Step-area series removed; rectangles will be drawn per bucket via ReferenceArea
  // Provide minimal frame data so Recharts lays out axes/domains even without a data series
  const frameData = useMemo(() => {
    const [minTick, maxTick] = xDomain;
    return [
      { tick: minTick, liquidityToken0: 0 },
      { tick: maxTick, liquidityToken0: 0 }
    ];
  }, [xDomain]);

  // Render only buckets overlapping the current view (with a small buffer)
  const visibleBuckets = useMemo(() => {
    if (!bucketLiquidityData || bucketLiquidityData.length === 0) return [] as BucketData[];
    const [viewMin, viewMax] = xDomain;
    const buffer = defaultTickSpacing * 4;
    const min = viewMin - buffer;
    const max = viewMax + buffer;
    return bucketLiquidityData.filter(b => b.tickUpper >= min && b.tickLower <= max);
  }, [bucketLiquidityData, xDomain, defaultTickSpacing]);

  // Calculate max bucket liquidity for chart scaling
  const maxBucketLiquidity = useMemo(() => {
    if (bucketLiquidityData.length === 0) return 1;
    const maxVal = Math.max(...bucketLiquidityData.map(d => parseFloat(d.liquidityToken0)));
    if (maxVal === 0) return 1;
    return maxVal / 0.6; // Set max so tallest bar is 60% of height
  }, [bucketLiquidityData]);

  // Calculate positions based on chart dimensions
  const getTickPosition = (tick: number) => {
    const [minTick, maxTick] = xDomain;
    const tickRange = maxTick - minTick;
    const position = ((tick - minTick) / tickRange) * 100;
    // Ensure position stays within container bounds (0% to 100%)
    return Math.max(0, Math.min(100, position));
  };

  const leftPos = getTickPosition(parseInt(tickLower));
  const rightPos = getTickPosition(parseInt(tickUpper));

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

  const applyDomainConstraintsLocal = (minTick: number, maxTick: number): [number, number] => {
    let constrainedMin = minTick;
    let constrainedMax = maxTick;
    const minDomainSize = defaultTickSpacing * 10;
    if (constrainedMax - constrainedMin < minDomainSize) {
      const center = (constrainedMin + constrainedMax) / 2;
      constrainedMin = center - minDomainSize / 2;
      constrainedMax = center + minDomainSize / 2;
    }
    if (currentPoolTick !== null) {
      const maxUpperDelta = Math.round(Math.log(6) / Math.log(1.0001));
      const maxLowerDelta = Math.round(Math.log(0.05) / Math.log(1.0001));
      const maxUpperTick = currentPoolTick + maxUpperDelta;
      const maxLowerTick = currentPoolTick + maxLowerDelta;
      constrainedMin = Math.max(constrainedMin, maxLowerTick);
      constrainedMax = Math.min(constrainedMax, maxUpperTick);
    }
    constrainedMin = Math.floor(constrainedMin / defaultTickSpacing) * defaultTickSpacing;
    constrainedMax = Math.ceil(constrainedMax / defaultTickSpacing) * defaultTickSpacing;
    if (constrainedMax - constrainedMin < minDomainSize) {
      const center = (constrainedMin + constrainedMax) / 2;
      constrainedMin = Math.floor((center - minDomainSize / 2) / defaultTickSpacing) * defaultTickSpacing;
      constrainedMax = Math.ceil((center + minDomainSize / 2) / defaultTickSpacing) * defaultTickSpacing;
    }
    return [constrainedMin, constrainedMax];
  };

  const handleBackgroundMouseMove = (e: MouseEvent) => {
    if (!isPanningViewport || !panViewportStartRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = e.clientX - panViewportStartRef.current.x;
    const [minTick, maxTick] = panViewportStartRef.current.domain;
    const domainSize = maxTick - minTick;
    const deltaTicks = (dx / rect.width) * domainSize;
    const newMin = minTick - deltaTicks;
    const newMax = maxTick - deltaTicks;
    const [cMin, cMax] = applyDomainConstraintsLocal(newMin, newMax);
    if (onXDomainChange) onXDomainChange([cMin, cMax]);
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
    const [minTick, maxTick] = xDomain;
    const tickRange = maxTick - minTick;
    const deltaTicks = (deltaX / containerWidth) * tickRange;

    let newTickLower = dragStart.tickLower;
    let newTickUpper = dragStart.tickUpper;

    if (isDragging === 'left') {
      // Constrain left handle to visible domain and maintain minimum spacing
      newTickLower = Math.min(dragStart.tickUpper - defaultTickSpacing, dragStart.tickLower + deltaTicks);
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      // Constrain to visible domain
      newTickLower = Math.max(minTick, Math.min(maxTick, newTickLower));
    } else if (isDragging === 'right') {
      // Constrain right handle to visible domain and maintain minimum spacing
      newTickUpper = Math.max(dragStart.tickLower + defaultTickSpacing, dragStart.tickUpper + deltaTicks);
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
      // Constrain to visible domain
      newTickUpper = Math.max(minTick, Math.min(maxTick, newTickUpper));
    } else if (isDragging === 'center') {
      // Constrain center dragging to keep entire range within visible domain
      const rangeWidth = dragStart.tickUpper - dragStart.tickLower;
      const newCenter = ((dragStart.tickLower + dragStart.tickUpper) / 2) + deltaTicks;
      newTickLower = newCenter - rangeWidth / 2;
      newTickUpper = newCenter + rangeWidth / 2;
      
      // Constrain the entire range to stay within visible domain
      if (newTickLower < minTick) {
        const adjustment = minTick - newTickLower;
        newTickLower = minTick;
        newTickUpper = newTickUpper + adjustment;
      }
      if (newTickUpper > maxTick) {
        const adjustment = newTickUpper - maxTick;
        newTickUpper = maxTick;
        newTickLower = newTickLower - adjustment;
      }
      
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
    }

    // Final constraint to valid range (broader constraint for edge cases)
    newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
    newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

    // Ensure minimum spacing
    if (newTickUpper - newTickLower < defaultTickSpacing) {
      if (isDragging === 'left') {
        newTickLower = newTickUpper - defaultTickSpacing;
      } else if (isDragging === 'right') {
        newTickUpper = newTickLower + defaultTickSpacing;
      }
    }

    onRangeChange(newTickLower.toString(), newTickUpper.toString());
    
    // Store the final position for viewport adjustment on mouse up
    finalDragPositionRef.current = { 
      tickLower: newTickLower, 
      tickUpper: newTickUpper,
      hitRightEdge: false, // Will be calculated on mouse up
      hitLeftEdge: false   // Will be calculated on mouse up
    };
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging || !dragStart || !containerRef.current) return;

    e.preventDefault(); // Prevent scrolling while dragging
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = touch.clientX - dragStart.x;
    const containerWidth = rect.width;
    const [minTick, maxTick] = xDomain;
    const tickRange = maxTick - minTick;
    const deltaTicks = (deltaX / containerWidth) * tickRange;

    let newTickLower = dragStart.tickLower;
    let newTickUpper = dragStart.tickUpper;

    if (isDragging === 'left') {
      // Constrain left handle to visible domain and maintain minimum spacing
      newTickLower = Math.min(dragStart.tickUpper - defaultTickSpacing, dragStart.tickLower + deltaTicks);
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      // Constrain to visible domain
      newTickLower = Math.max(minTick, Math.min(maxTick, newTickLower));
    } else if (isDragging === 'right') {
      // Constrain right handle to visible domain and maintain minimum spacing
      newTickUpper = Math.max(dragStart.tickLower + defaultTickSpacing, dragStart.tickUpper + deltaTicks);
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
      // Constrain to visible domain
      newTickUpper = Math.max(minTick, Math.min(maxTick, newTickUpper));
    } else if (isDragging === 'center') {
      // Constrain center dragging to keep entire range within visible domain
      const rangeWidth = dragStart.tickUpper - dragStart.tickLower;
      const newCenter = ((dragStart.tickLower + dragStart.tickUpper) / 2) + deltaTicks;
      newTickLower = newCenter - rangeWidth / 2;
      newTickUpper = newCenter + rangeWidth / 2;
      
      // Constrain the entire range to stay within visible domain
      if (newTickLower < minTick) {
        const adjustment = minTick - newTickLower;
        newTickLower = minTick;
        newTickUpper = newTickUpper + adjustment;
      }
      if (newTickUpper > maxTick) {
        const adjustment = newTickUpper - maxTick;
        newTickUpper = maxTick;
        newTickLower = newTickLower - adjustment;
      }
      
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
    }

    // Final constraint to valid range (broader constraint for edge cases)
    newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
    newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

    // Ensure minimum spacing
    if (newTickUpper - newTickLower < defaultTickSpacing) {
      if (isDragging === 'left') {
        newTickLower = newTickUpper - defaultTickSpacing;
      } else if (isDragging === 'right') {
        newTickUpper = newTickLower + defaultTickSpacing;
      }
    }

    onRangeChange(newTickLower.toString(), newTickUpper.toString());
    
    // Store the final position for viewport adjustment on touch end
    finalDragPositionRef.current = { 
      tickLower: newTickLower, 
      tickUpper: newTickUpper,
      hitRightEdge: false, // Will be calculated on touch end
      hitLeftEdge: false   // Will be calculated on touch end
    };
  };

  const handleMouseUp = () => {
    if (onXDomainChange && finalDragPositionRef.current) {
      const { tickLower: finalTickLower, tickUpper: finalTickUpper } = finalDragPositionRef.current;
      let [currentMinTick, currentMaxTick] = xDomain;
      const currentDomainSize = currentMaxTick - currentMinTick;
      const minDomainSize = defaultTickSpacing * 10;
      const minSelectionRatio = 0.2;

      // Detect if we touched either edge of the current viewport
      const touchedLeft = finalTickLower <= currentMinTick;
      const touchedRight = finalTickUpper >= currentMaxTick;

      // Only expand viewport if an edge was touched; expand that side by 25%
      if (touchedLeft || touchedRight) {
        let newMinTick = currentMinTick;
        let newMaxTick = currentMaxTick;
        const expandBy = Math.max(minDomainSize, currentDomainSize) * 0.25;

        if (touchedLeft) newMinTick = currentMinTick - expandBy;
        if (touchedRight) newMaxTick = currentMaxTick + expandBy;

        // Apply global constraints
        if (currentPoolTick !== null) {
          const maxUpperDelta = Math.round(Math.log(6) / Math.log(1.0001)); // +500%
          const maxLowerDelta = Math.round(Math.log(0.05) / Math.log(1.0001)); // -95%
          const maxUpperTick = currentPoolTick + maxUpperDelta;
          const maxLowerTick = currentPoolTick + maxLowerDelta;
          newMinTick = Math.max(newMinTick, maxLowerTick);
          newMaxTick = Math.min(newMaxTick, maxUpperTick);
        }

        // Align and enforce minimum domain
        newMinTick = Math.floor(newMinTick / defaultTickSpacing) * defaultTickSpacing;
        newMaxTick = Math.ceil(newMaxTick / defaultTickSpacing) * defaultTickSpacing;
        if (newMaxTick - newMinTick < minDomainSize) {
          const center = (newMinTick + newMaxTick) / 2;
          newMinTick = center - minDomainSize / 2;
          newMaxTick = center + minDomainSize / 2;
          newMinTick = Math.floor(newMinTick / defaultTickSpacing) * defaultTickSpacing;
          newMaxTick = Math.ceil(newMaxTick / defaultTickSpacing) * defaultTickSpacing;
        }

        onXDomainChange([newMinTick, newMaxTick]);
      } else {
        // Enforce minimum selection width: if selection < 20% of view, zoom in
        const selectionSize = finalTickUpper - finalTickLower;
        if (selectionSize > 0 && selectionSize < currentDomainSize * minSelectionRatio) {
          const targetSize = Math.max(minDomainSize, currentDomainSize * minSelectionRatio);
          const center = (finalTickLower + finalTickUpper) / 2;
          const [cMin, cMax] = applyDomainConstraintsLocal(center - targetSize / 2, center + targetSize / 2);
          onXDomainChange([cMin, cMax]);
        }
      }
    }

    setIsDragging(null);
    if (onDragStateChange) onDragStateChange(null);
    setDragStart(null);
    finalDragPositionRef.current = null;
  };

  const handleTouchEnd = () => {
    // Use the same logic as handleMouseUp
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
    const [cMin, cMax] = applyDomainConstraintsLocal(center - newHalf, center + newHalf);
    if (onXDomainChange) onXDomainChange([cMin, cMax]);
  };

  const centerOnCurrentPrice = () => {
    if (currentPoolTick === null) return;
    const [minTick, maxTick] = xDomain;
    const size = Math.max(defaultTickSpacing * 10, maxTick - minTick);
    const [cMin, cMax] = applyDomainConstraintsLocal(currentPoolTick - size / 2, currentPoolTick + size / 2);
    if (onXDomainChange) onXDomainChange([cMin, cMax]);
  };

  return (
    <div className="space-y-2">
      {/* Legend removed per UX request */}
      <div 
        className="relative h-[80px] w-full touch-manipulation" 
        ref={containerRef}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => { setIsHovering(false); stopBackgroundPan(); }}
        onMouseDown={handleBackgroundMouseDown}
        onTouchStart={(e) => {
          // Prevent scrolling when touching the chart area
          if (e.touches.length === 1) {
            e.preventDefault();
          }
        }}
      >
        {/* Chart */}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart 
            data={frameData}
            margin={{ top: 2, right: 5, bottom: 5, left: 5 }}
          >
            {/* Disable hover cursor/tooltip entirely */}
            <RechartsTooltip cursor={false} content={() => null} />
            <XAxis 
              dataKey="tick" 
              type="number" 
              domain={xDomain} 
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
              domain={[0, maxBucketLiquidity]}
              allowDecimals={true}
            />
            
            {/* Draw per-bucket rectangles aligned to [tickLower, tickUpper], touching; culled to viewport */}
            {visibleBuckets.map((bucket, idx) => (
              <ReferenceArea
                key={`bucket-${bucket.tickLower}-${idx}`}
                x1={bucket.tickLower}
                x2={bucket.tickUpper}
                y1={parseFloat(bucket.liquidityToken0)}
                y2={0}
                yAxisId="bucketAxis"
                strokeOpacity={0}
                fill="#404040"
                fillOpacity={0.4}
                ifOverflow="extendDomain"
              />
            ))}
            
            {currentPoolTick !== null && (
              <ReferenceLine 
                x={currentPoolTick} 
                stroke="#e85102"
                strokeWidth={1.5} 
                ifOverflow="extendDomain"
                yAxisId="bucketAxis"
              />
            )}
            
            <ReferenceArea 
              x1={parseInt(tickLower)} 
              x2={parseInt(tickUpper)} 
              yAxisId="bucketAxis"
              strokeOpacity={0} 
              fill="#e85102" 
              fillOpacity={0.25} 
              ifOverflow="extendDomain"
              shape={(props) => {
                const { x, y, width, height } = props;
                if (!x || !y || !width || !height) {
                  return <rect x={0} y={0} width={0} height={0} />;
                }
                
                // Sharp bottom corners, rounded top corners
                const radius = 6;
                
                return (
                  <path
                    d={`M ${x} ${y + height} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} L ${x + width - radius} ${y} Q ${x + width} ${y} ${x + width} ${y + radius} L ${x + width} ${y + height} Z`}
                    fill="#e85102"
                    fillOpacity={0.25}
                  />
                );
              }}
            />
            {/* Floating tooltip for live lower/upper price during drag - rendered outside chart container */}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Interactive drag handles */}
        <div className={`absolute inset-0 pointer-events-none transition-opacity duration-200 ${isHovering || isMobile ? 'opacity-100' : 'opacity-0'}`}>
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
            className="absolute top-1/2 -translate-y-1/2 w-4 h-1/3 flex items-center justify-center pointer-events-auto cursor-pointer group"
            style={{ left: `calc(${leftPos}% + 4px)` }}
            onMouseDown={(e) => handleMouseDown(e, 'left')}
            onTouchStart={(e) => handleTouchStart(e, 'left')}
          >
            <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm bg-muted/30 group-hover:bg-muted/10 transition-colors">
              <ChevronLeft className="h-3 w-3 text-[#a1a1aa] group-hover:hidden" />
              <div className="hidden group-hover:flex items-center justify-center gap-0.5">
                <div className="w-px h-2 bg-[#a1a1aa]"></div>
                <div className="w-px h-2 bg-[#a1a1aa]"></div>
              </div>
            </div>
          </div>
          
          {/* Right handle */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-1/3 flex items-center justify-center pointer-events-auto cursor-pointer group"
            style={{ left: `calc(${rightPos}% - 20px)` }}
            onMouseDown={(e) => handleMouseDown(e, 'right')}
            onTouchStart={(e) => handleTouchStart(e, 'right')}
          >
            <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm bg-muted/30 group-hover:bg-muted/10 transition-colors">
              <ChevronRight className="h-3 w-3 text-[#a1a1aa] group-hover:hidden" />
              <div className="hidden group-hover:flex items-center justify-center gap-0.5">
                <div className="w-px h-2 bg-[#a1a1aa]"></div>
                <div className="w-px h-2 bg-[#a1a1aa]"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Hover-only zoom controls */}
        <div className={`absolute top-1 right-1 flex gap-1 pointer-events-auto transition-opacity duration-200 ${isHovering ? 'opacity-100' : 'opacity-0'}`}>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:brightness-110 hover:border-white/30"
            onClick={() => zoomByFactor(0.8)}
            aria-label="Zoom in"
          >
            <PlusIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:brightness-110 hover:border-white/30"
            onClick={() => zoomByFactor(1.25)}
            aria-label="Zoom out"
          >
            <MinusIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center rounded border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:brightness-110 hover:border-white/30"
            onClick={centerOnCurrentPrice}
            aria-label="Center on current price"
          >
            {/* Parallel drag-like lines icon */}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="opacity-80">
              <rect x="4" y="2" width="1" height="8" rx="0.5" fill="currentColor" />
              <rect x="7" y="2" width="1" height="8" rx="0.5" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Custom X-Axis Labels for Preview (using optimal denomination) */}
      <div className="flex justify-between w-full px-[5px] box-border">
        {previewXAxisTicks.map((labelItem, index) => (
          <span key={index} className="text-xs text-muted-foreground">
            {labelItem.displayLabel}
          </span>
        ))}
      </div>
    </div>
  );
} 