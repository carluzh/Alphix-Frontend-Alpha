"use client";

import { useMemo, useState, useEffect } from "react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Area, ReferenceLine, ReferenceArea } from "recharts";

interface TickRangePreviewProps {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  tickSpacing: number;
  poolId?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  currentPrice?: string | null;
  bare?: boolean; // when true, no background/rounded styles
}

interface BucketData {
  tickLower: number;
  tickUpper: number;
  midTick: number;
  liquidityToken0: string;
}



export function TickRangePreview({ 
  tickLower, 
  tickUpper, 
  currentTick, 
  tickSpacing,
  poolId,
  token0Symbol,
  token1Symbol,
  currentPrice,
  bare
}: TickRangePreviewProps) {
  const [bucketData, setBucketData] = useState<BucketData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Calculate the domain for display (always show current price ±5% and position range)
  const xDomain = useMemo(() => {
    // Validate input tick values
    if (!isFinite(tickLower) || !isFinite(tickUpper) || tickLower >= tickUpper) {
      console.warn('[TickRangePreview] Invalid tick range:', { tickLower, tickUpper });
      return [-1000, 1000]; // Fallback range
    }
    
    // Use a reasonable range around the position regardless of current price/tick
    const positionRange = Math.abs(tickUpper - tickLower);
    const maxRange = 5000; // Limit the range to prevent API overload
    const padding = Math.min(positionRange * 0.5, maxRange * 0.3); // Reasonable padding
    const minTick = Math.min(tickLower, tickUpper) - padding;
    const maxTick = Math.max(tickLower, tickUpper) + padding;
    
    // Ensure the range isn't too large for the API
    const finalRange = maxTick - minTick;
    if (finalRange > maxRange) {
      const center = (tickLower + tickUpper) / 2;
      return [center - maxRange/2, center + maxRange/2];
    }
    
    return [minTick, maxTick];
  }, [tickLower, tickUpper, currentTick, currentPrice]);

  // Determine if we need to flip the denomination to show higher prices
  const shouldFlipDenomination = useMemo(() => {
    if (!currentPrice || !token0Symbol || !token1Symbol) return false;
    
    const currentPriceNum = parseFloat(currentPrice);
    const inversePrice = 1 / currentPriceNum;
    
    // If the inverse price is larger, we should flip the denomination
    return inversePrice > currentPriceNum;
  }, [currentPrice, token0Symbol, token1Symbol]);

  // Calculate if axis should be flipped based on price order
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
    return shouldFlip;
  }, [currentTick, currentPrice, token0Symbol, bucketData, shouldFlipDenomination]);

  // Fetch real liquidity depth data
  useEffect(() => {
    const fetchBucketData = async () => {
      if (!poolId || !tickSpacing) {
        console.log('[TickRangePreview] Missing poolId or tickSpacing:', { poolId, tickSpacing });
        return;
      }
      
      // Validate xDomain values before making API call
      const [minTick, maxTick] = xDomain;
      if (!isFinite(minTick) || !isFinite(maxTick) || minTick >= maxTick) {
        console.warn('[TickRangePreview] Invalid xDomain values:', xDomain);
        return;
      }
      
      const requestData = {
        poolId,
        tickLower: Math.floor(minTick),
        tickUpper: Math.ceil(maxTick),
        tickSpacing: Number(tickSpacing),
        bucketCount: 25
      };
      
      console.log('[TickRangePreview] API request data:', requestData);
      
      setIsLoading(true);
      try {
        const response = await fetch('/api/liquidity/get-bucket-depths', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success && result.buckets) {
          setBucketData(result.buckets);
        }
      } catch (error) {
        console.error('[TickRangePreview] Error fetching bucket data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBucketData();
  }, [poolId, xDomain, tickSpacing]);

  // Convert bucket data to chart data with proper ordering
  const chartData = useMemo(() => {
    if (bucketData.length === 0) return [];
    
    let data = bucketData.map(bucket => ({
      tick: bucket.midTick,
      liquidityDepth: parseFloat(bucket.liquidityToken0)
    }));

    // Sort by tick to ensure proper order
    data.sort((a, b) => a.tick - b.tick);

    // If axis is flipped, reverse the data to maintain ascending price order
    if (isAxisFlipped) {
      data.reverse();
    }

    return data;
  }, [bucketData, isAxisFlipped]);

  // Calculate max liquidity for chart scaling
  const maxLiquidity = useMemo(() => {
    if (chartData.length === 0) return 100;
    const maxVal = Math.max(...chartData.map(d => d.liquidityDepth));
    return maxVal / 0.6; // Set max so tallest bar is 60% of height
  }, [chartData]);

  // If loading or no data, show loading state
  if (isLoading) {
    return (
      <div className="w-full h-full bg-muted/30 rounded-lg flex items-center justify-center">
        <img 
          src="/Logo Icon (white).svg" 
          alt="Loading" 
          className="w-6 h-6 animate-pulse" 
        />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="w-full h-full bg-muted/30 rounded-lg flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  return (
    <div className={bare ? "w-full h-full overflow-hidden" : "w-full h-full bg-muted/30 rounded-lg overflow-hidden"}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
          data={chartData}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis 
            dataKey="tick" 
            type="number" 
            domain={xDomain} 
            hide
          />
          <YAxis 
            hide
            domain={[0, maxLiquidity]}
          />
          
          <Area
            type="step"
            dataKey="liquidityDepth"
            fill="#404040"
            fillOpacity={0.4}
            stroke="#404040"
            strokeWidth={1}
            dot={false}
            activeDot={false}
          />
          
          {currentTick !== null && currentTick !== undefined && (
            <ReferenceLine 
              x={currentTick} 
              stroke="#e85102"
              strokeWidth={1.5}
            />
          )}
          
          <ReferenceArea 
            x1={tickLower} 
            x2={tickUpper} 
            fill="#e85102" 
            fillOpacity={0.25}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
