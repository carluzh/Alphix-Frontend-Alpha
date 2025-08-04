"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Area, ReferenceLine, ReferenceArea } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  poolToken1
}: InteractiveRangeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | 'center' | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; tickLower: number; tickUpper: number } | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const finalDragPositionRef = useRef<{ 
    tickLower: number; 
    tickUpper: number; 
    hitRightEdge: boolean; 
    hitLeftEdge: boolean; 
  } | null>(null);

  // Chart data state
  const [rawHookPositions, setRawHookPositions] = useState<Array<HookPosition & { pool: string }> | null>(null);
  const [processedPositions, setProcessedPositions] = useState<ProcessedPositionDetail[] | null>(null);
  const [bucketLiquidityData, setBucketLiquidityData] = useState<BucketData[]>([]);
  const [isFetchingLiquidityDepth, setIsFetchingLiquidityDepth] = useState(false);
  const [isChartDataLoading, setIsChartDataLoading] = useState(false);

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
    const bucketSize = Math.max(range / bucketCount, tickSpacing);
    const alignedBucketSize = Math.ceil(bucketSize / tickSpacing) * tickSpacing;
    
    const buckets: { tickLower: number; tickUpper: number }[] = [];
    let currentTick = tickLower;
    
    while (currentTick < tickUpper) {
      const bucketUpper = Math.min(currentTick + alignedBucketSize, tickUpper);
      buckets.push({
        tickLower: currentTick,
        tickUpper: bucketUpper
      });
      currentTick = bucketUpper;
    }
    
    return buckets;
  }, []);

  // Generate bucket liquidity data
  useEffect(() => {
    console.log("[InteractiveRangeChart] Bucket data generation:", {
      processedPositions: processedPositions?.length || 0,
      xDomain,
      defaultTickSpacing
    });
    
    if (processedPositions && processedPositions.length > 0 && xDomain) {
      const [minTick, maxTick] = xDomain;
      const buckets = calculateTickBuckets(minTick, maxTick, defaultTickSpacing, 25);
      
      const bucketData: BucketData[] = [];
      
      for (const bucket of buckets) {
        let bucketLiquidity = 0;
        
        for (const position of processedPositions) {
          const posTickLower = position.tickLower;
          const posTickUpper = position.tickUpper;
          
          if (posTickLower < bucket.tickUpper && posTickUpper > bucket.tickLower) {
            bucketLiquidity += position.unifiedValueInToken0;
          }
        }
        
        bucketData.push({
          tickLower: bucket.tickLower,
          tickUpper: bucket.tickUpper,
          midTick: Math.floor((bucket.tickLower + bucket.tickUpper) / 2),
          liquidityToken0: bucketLiquidity.toFixed(2)
        });
      }
      
      console.log("[InteractiveRangeChart] Generated bucket data:", bucketData.length, "buckets");
      setBucketLiquidityData(bucketData);
    } else {
      console.log("[InteractiveRangeChart] No bucket data generated - missing dependencies");
      setBucketLiquidityData([]);
    }
  }, [processedPositions, xDomain, defaultTickSpacing, calculateTickBuckets]);

  // Calculate if axis should be flipped based on price order
  const isAxisFlipped = useMemo(() => {
    if (!currentPoolTick || !currentPrice || !optimalDenomination || !token0Symbol || bucketLiquidityData.length < 2) {
      console.log("[InteractiveRangeChart] Axis flip calculation skipped - missing dependencies:", {
        currentPoolTick,
        currentPrice,
        optimalDenomination,
        token0Symbol,
        bucketLiquidityDataLength: bucketLiquidityData.length
      });
      return false;
    }
    
    const currentPriceNum = parseFloat(currentPrice);
    
    const tickSortedBuckets = [...bucketLiquidityData].sort((a, b) => a.midTick - b.midTick);
    const firstByTick = tickSortedBuckets[0];
    const secondByTick = tickSortedBuckets[1];
    
    console.log("[InteractiveRangeChart] Bucket data for axis flip:", {
      bucketCount: bucketLiquidityData.length,
      firstBucket: firstByTick,
      secondBucket: secondByTick
    });
    
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
    console.log("[InteractiveRangeChart] Axis flip calculation:", {
      shouldFlipDenomination,
      currentPrice: currentPriceNum,
      firstTick: firstByTick.midTick,
      secondTick: secondByTick.midTick,
      firstDelta,
      secondDelta,
      firstPrice,
      secondPrice,
      shouldFlip
    });
    
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
        
        // Calculate prices for left border, center (current), and right border
        const tickPositions = [minTickDomain, currentPoolTick, maxTickDomain];
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
          const displayLabel = pricePoint.price.toLocaleString(undefined, { 
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

  // Generate chart data with proper ordering
  const chartData = useMemo(() => {
    if (bucketLiquidityData.length === 0) {
      return [];
    }

    let data: DepthChartDataPoint[] = bucketLiquidityData.map(bucket => ({
      tick: bucket.midTick,
      token0Depth: parseFloat(bucket.liquidityToken0),
      liquidityToken0: parseFloat(bucket.liquidityToken0),
      bucketWidth: bucket.tickUpper - bucket.tickLower
    }));

    // Sort by tick to ensure proper order
    data.sort((a, b) => a.tick - b.tick);

    // If axis is flipped, reverse the data to maintain ascending price order
    if (isAxisFlipped) {
      data.reverse();
    }

    return data;
  }, [bucketLiquidityData, isAxisFlipped]);

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
    return ((tick - minTick) / tickRange) * 100;
  };

  const leftPos = getTickPosition(parseInt(tickLower));
  const rightPos = getTickPosition(parseInt(tickUpper));

  const handleMouseDown = (e: React.MouseEvent, side: 'left' | 'right' | 'center') => {
    e.preventDefault();
    setIsDragging(side);
    setDragStart({
      x: e.clientX,
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
      // Allow unlimited dragging for left handle, but keep minimum spacing
      newTickLower = Math.min(dragStart.tickUpper - defaultTickSpacing, dragStart.tickLower + deltaTicks);
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
    } else if (isDragging === 'right') {
      // Allow unlimited dragging for right handle, but keep minimum spacing
      newTickUpper = Math.max(dragStart.tickLower + defaultTickSpacing, dragStart.tickUpper + deltaTicks);
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
    } else if (isDragging === 'center') {
      // Allow unlimited dragging for center, maintaining range width
      const rangeWidth = dragStart.tickUpper - dragStart.tickLower;
      const newCenter = ((dragStart.tickLower + dragStart.tickUpper) / 2) + deltaTicks;
      newTickLower = newCenter - rangeWidth / 2;
      newTickUpper = newCenter + rangeWidth / 2;
      newTickLower = Math.round(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = Math.round(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
    }

    // Ensure ticks are within valid range
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

  const handleMouseUp = () => {
    if (onXDomainChange && finalDragPositionRef.current) {
      const { tickLower: finalTickLower, tickUpper: finalTickUpper } = finalDragPositionRef.current;
      const [currentMinTick, currentMaxTick] = xDomain;
      
      // Calculate new domain with margins around the final position
      const finalRange = finalTickUpper - finalTickLower;
      const marginFactor = 0.05; // 5% margin on each side
      let sideMargin = finalRange * marginFactor; // Always use 5% of selection range
      
      // Apply minimum domain size constraint: ensure at least 10 tick spacings visible
      const minDomainSize = defaultTickSpacing * 10;
      const currentDomainSize = currentMaxTick - currentMinTick;
      if (currentDomainSize < minDomainSize) {
        sideMargin = Math.max(sideMargin, (minDomainSize - finalRange) / 2);
      }
      
      // Calculate ideal domain that fits the selection with margins
      let idealMinTick = finalTickLower - sideMargin;
      let idealMaxTick = finalTickUpper + sideMargin;
      
      // Apply maximum view range constraint: 500% above and 95% below current price
      if (currentPoolTick !== null) {
        const maxUpperDelta = Math.round(Math.log(6) / Math.log(1.0001)); // 500% above = 6x price
        const maxLowerDelta = Math.round(Math.log(0.05) / Math.log(1.0001)); // 95% below = 0.05x price
        
        const maxUpperTick = currentPoolTick + maxUpperDelta;
        const maxLowerTick = currentPoolTick + maxLowerDelta;
        
        // Clamp the ideal domain to the maximum view range
        idealMinTick = Math.max(idealMinTick, maxLowerTick);
        idealMaxTick = Math.min(idealMaxTick, maxUpperTick);
      }
      
      // Ensure the ideal domain is properly aligned to tick spacing
      idealMinTick = Math.floor(idealMinTick / defaultTickSpacing) * defaultTickSpacing;
      idealMaxTick = Math.ceil(idealMaxTick / defaultTickSpacing) * defaultTickSpacing;
      
      // Ensure minimum domain size is maintained after constraints
      const constrainedDomainSize = idealMaxTick - idealMinTick;
      if (constrainedDomainSize < minDomainSize) {
        const centerTick = (idealMinTick + idealMaxTick) / 2;
        idealMinTick = centerTick - minDomainSize / 2;
        idealMaxTick = centerTick + minDomainSize / 2;
        
        // Re-align to tick spacing
        idealMinTick = Math.floor(idealMinTick / defaultTickSpacing) * defaultTickSpacing;
        idealMaxTick = Math.ceil(idealMaxTick / defaultTickSpacing) * defaultTickSpacing;
      }
      
      // Determine if we need to expand or can shrink the viewport
      const needsExpansion = finalTickLower < currentMinTick || finalTickUpper > currentMaxTick;
      const canShrink = idealMinTick > currentMinTick || idealMaxTick < currentMaxTick;
      
      if (needsExpansion || canShrink) {
        // Use the ideal domain that fits the selection with proper margins
        let newMinTick = idealMinTick;
        let newMaxTick = idealMaxTick;
        
        // If we're only shrinking (not expanding), we might want to be more conservative
        if (!needsExpansion && canShrink) {
          // When shrinking, ensure we don't make the viewport too small
          const minViewportSize = finalRange * 3; // Minimum 3x the selection range
          const currentViewportSize = newMaxTick - newMinTick;
          
          if (currentViewportSize < minViewportSize) {
            const centerTick = (finalTickLower + finalTickUpper) / 2;
            newMinTick = centerTick - minViewportSize / 2;
            newMaxTick = centerTick + minViewportSize / 2;
            
            // Re-align to tick spacing
            newMinTick = Math.floor(newMinTick / defaultTickSpacing) * defaultTickSpacing;
            newMaxTick = Math.ceil(newMaxTick / defaultTickSpacing) * defaultTickSpacing;
          }
        }
        
        // Apply domain constraints before calling onXDomainChange
        const minDomainSize = defaultTickSpacing * 10;
        
        console.log("[InteractiveRangeChart] Adjusting viewport for final position:", {
          finalTickLower,
          finalTickUpper,
          currentDomain: [currentMinTick, currentMaxTick],
          idealDomain: [idealMinTick, idealMaxTick],
          newDomain: [newMinTick, newMaxTick],
          needsExpansion,
          canShrink,
          minDomainSize,
          constrainedDomainSize: idealMaxTick - idealMinTick
        });
        
        let constrainedMinTick = newMinTick;
        let constrainedMaxTick = newMaxTick;
        
        // Apply minimum domain size constraint
        const domainSize = constrainedMaxTick - constrainedMinTick;
        if (domainSize < minDomainSize) {
          const centerTick = (constrainedMinTick + constrainedMaxTick) / 2;
          constrainedMinTick = centerTick - minDomainSize / 2;
          constrainedMaxTick = centerTick + minDomainSize / 2;
        }
        
        // Apply maximum view range constraint: 500% above and 95% below current price
        if (currentPoolTick !== null) {
          const constraintMaxUpperDelta = Math.round(Math.log(6) / Math.log(1.0001)); // 500% above = 6x price
          const constraintMaxLowerDelta = Math.round(Math.log(0.05) / Math.log(1.0001)); // 95% below = 0.05x price
          
          const constraintMaxUpperTick = currentPoolTick + constraintMaxUpperDelta;
          const constraintMaxLowerTick = currentPoolTick + constraintMaxLowerDelta;
          
          // Clamp the domain to the maximum view range
          constrainedMinTick = Math.max(constrainedMinTick, constraintMaxLowerTick);
          constrainedMaxTick = Math.min(constrainedMaxTick, constraintMaxUpperTick);
        }
        
        // Ensure the domain is properly aligned to tick spacing
        constrainedMinTick = Math.floor(constrainedMinTick / defaultTickSpacing) * defaultTickSpacing;
        constrainedMaxTick = Math.ceil(constrainedMaxTick / defaultTickSpacing) * defaultTickSpacing;
        
        // Ensure minimum domain size is maintained after constraints
        const finalDomainSize = constrainedMaxTick - constrainedMinTick;
        if (finalDomainSize < minDomainSize) {
          const centerTick = (constrainedMinTick + constrainedMaxTick) / 2;
          constrainedMinTick = centerTick - minDomainSize / 2;
          constrainedMaxTick = centerTick + minDomainSize / 2;
          
          // Re-align to tick spacing
          constrainedMinTick = Math.floor(constrainedMinTick / defaultTickSpacing) * defaultTickSpacing;
          constrainedMaxTick = Math.ceil(constrainedMaxTick / defaultTickSpacing) * defaultTickSpacing;
        }
        
        onXDomainChange([constrainedMinTick, constrainedMaxTick]);
      }
    }
    
    setIsDragging(null);
    setDragStart(null);
    finalDragPositionRef.current = null;
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  return (
    <div className="space-y-2">
      <div 
        className="relative h-[80px] w-full" 
        ref={containerRef}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Chart */}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart 
            data={chartData}
            margin={{ top: 2, right: 5, bottom: 5, left: 5 }}
          >
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
            
            <Area
              type="step"
              dataKey="liquidityToken0"
              fill="#404040"
              fillOpacity={0.8}
              strokeWidth={0}
              yAxisId="bucketAxis"
              name="Liquidity Depth"
              activeDot={false}
            />
            
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
                
                const radius = isHovering ? 0 : 6;
                
                return (
                  <path
                    d={`M ${x} ${y + height} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} L ${x + width - radius} ${y} Q ${x + width} ${y} ${x + width} ${y + radius} L ${x + width} ${y + height} Z`}
                    fill="#e85102"
                    fillOpacity={0.25}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Interactive drag handles */}
        <div className={`absolute inset-0 pointer-events-none transition-opacity duration-200 ${isHovering ? 'opacity-100' : 'opacity-0'}`}>
          {/* Invisible center area - drag to move entire range */}
          <div 
            className="absolute top-0 bottom-0 pointer-events-auto cursor-move"
            style={{ 
              left: `${leftPos}%`, 
              width: `${rightPos - leftPos}%`
            }}
            onMouseDown={(e) => handleMouseDown(e, 'center')}
          />
          
          {/* Left handle */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-1/3 flex items-center justify-center pointer-events-auto cursor-pointer group"
            style={{ left: `calc(${leftPos}% + 4px)` }}
            onMouseDown={(e) => handleMouseDown(e, 'left')}
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