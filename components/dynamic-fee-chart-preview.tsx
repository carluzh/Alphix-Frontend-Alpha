"use client"

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { getToken, getPoolByTokens } from "@/lib/pools-config";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

interface FeeHistoryPoint {
  timeLabel: string;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Expecting percentage points, e.g., 0.31 for 0.31%
}

interface DynamicFeeChartPreviewProps {
  data: FeeHistoryPoint[];
  onClick?: () => void; // To handle click for opening the modal
  poolInfo?: {
    token0Symbol: string;
    token1Symbol: string;
    poolName: string;
  };
  isLoading?: boolean; // Show loading state during pool switches
  onContentStableChange?: (stable: boolean) => void; // New callback prop
  alwaysShowSkeleton?: boolean; // Force skeleton even with no data (e.g., homepage preview)
  totalPools?: number; // multihop: number of pools (kept for compatibility, not rendered here)
  activePoolIndex?: number; // which pool is currently selected (kept for compatibility)
}

function DynamicFeeChartPreviewComponent({ data, onClick, poolInfo, isLoading = false, onContentStableChange, alwaysShowSkeleton = false }: DynamicFeeChartPreviewProps) {
  const router = useRouter();
  
  // State to track if the content is stable and rendered
  const [isContentStable, setIsContentStable] = useState(false);
  
  // Debug state for artificial loading delay
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);

  // Ref to store previous data for comparison
  const previousDataRef = useRef<FeeHistoryPoint[] | null>(null);
  const previousChartDataRef = useRef<any[] | null>(null);
  
  // Memoized data comparison to prevent unnecessary re-renders
  const hasDataChanged = useMemo(() => {
    if (!data || !previousDataRef.current) {
      return true; // First render or no previous data
    }
    
    // Quick length check
    if (data.length !== previousDataRef.current.length) {
      return true;
    }
    
    // Deep comparison of data points
    for (let i = 0; i < data.length; i++) {
      const current = data[i];
      const previous = previousDataRef.current[i];
      
      if (!previous) return true;
      
      // Compare key properties that affect the chart
      if (
        current.volumeTvlRatio !== previous.volumeTvlRatio ||
        current.emaRatio !== previous.emaRatio ||
        current.dynamicFee !== previous.dynamicFee ||
        current.timeLabel !== previous.timeLabel
      ) {
        return true;
      }
    }
    
    return false; // Data is the same
  }, [data]);
  
  // Update previous data ref when data actually changes
  useEffect(() => {
    if (hasDataChanged) {
      previousDataRef.current = data;
    }
  }, [hasDataChanged, data]);

  // Effect to signal when content is stable
  useEffect(() => {
    if (!isLoading && data && data.length > 0) {
      // Allow a small delay for any internal animations to settle
      const timer = setTimeout(() => {
        setIsContentStable(true);
        onContentStableChange?.(true);
      }, 50); // Small delay to ensure render

      return () => clearTimeout(timer);
    } else {
      // Reset if data is loading or not available
      if (isContentStable) {
        setIsContentStable(false);
        onContentStableChange?.(false);
      }
    }
  }, [isLoading, data, onContentStableChange, isContentStable]);

  // Debug/UX effect for loading skeleton visibility
  useEffect(() => {
    if (alwaysShowSkeleton) {
      setShowLoadingSkeleton(true);
      return;
    }
    if (isLoading) {
      setShowLoadingSkeleton(true);
      const timer = setTimeout(() => {
        setShowLoadingSkeleton(false);
      }, 1000); // 1 second delay for debugging
      return () => clearTimeout(timer);
    } else {
      // Immediately hide skeleton when not loading
      setShowLoadingSkeleton(false);
    }
  }, [isLoading, alwaysShowSkeleton]);

  // Handle click to navigate to pool page
  const handleClick = () => {
    if (!poolInfo) return;

    // Derive a friendly route id; avoid using raw subgraph id (0x...) in the URL
    const maybeCanonical = (poolInfo as any).id || (poolInfo as any).poolId;
    let targetId: string | undefined;

    // If a provided id is a friendly slug (not 0x...), use it directly
    if (maybeCanonical && !String(maybeCanonical).startsWith('0x')) {
      targetId = String(maybeCanonical);
    } else {
      // Fallback: map from token symbols to configured pool
      const poolConfig = getPoolByTokens(poolInfo.token0Symbol, poolInfo.token1Symbol);
      if (poolConfig) targetId = poolConfig.id;
    }

    if (targetId) {
      const href = `/liquidity/${targetId}`;
      if (typeof window !== 'undefined') {
        window.open(href, '_blank', 'noopener,noreferrer');
      } else {
        router.push(href);
      }
    } else {
      console.warn(`No pool configuration found for ${poolInfo.token0Symbol}/${poolInfo.token1Symbol}`);
    }
  };

  // Memoized chart data calculation - only recalculate when data actually changes
  const chartData = useMemo(() => {
    // Return null if no data
    if (!data || data.length === 0) {
      return null;
    }
    
    // Return cached chart data if data hasn't changed
    if (!hasDataChanged && previousChartDataRef.current) {
      return previousChartDataRef.current;
    }
    
    // When data is available, render the full chart preview
    const volumeTvlRatios = data.map(point => point.volumeTvlRatio);
    const emaRatios = data.map(point => point.emaRatio);
    const dynamicFees = data.map(point => point.dynamicFee);

    // Check if data has variation
    const nonZeroVolume = volumeTvlRatios.filter(v => v > 0);
    const nonZeroEma = emaRatios.filter(v => v > 0);
    const hasVariation = nonZeroVolume.length > 0 || nonZeroEma.length > 0;

    // Find the max values for better scaling
    const maxVolume = Math.max(...volumeTvlRatios);
    const maxEma = Math.max(...emaRatios);
    const maxFee = Math.max(...dynamicFees);
    const minFee = Math.min(...dynamicFees);

    // Smart normalization for sparse data with better spike visibility
    const newChartData = data.map((point, index) => {
      // Volume normalization: make spikes more visible in preview
      let normalizedVolume = 40; // Lower baseline to make spikes more prominent
      if (point.volumeTvlRatio > 0 && nonZeroVolume.length > 0) {
        const minNonZeroVolume = Math.min(...volumeTvlRatios.filter(v => v > 0));
        // Use a more aggressive scaling to make spikes visible
        const volumeScale = Math.min(point.volumeTvlRatio / maxVolume, 1); // Cap at 100%
        normalizedVolume = 40 + (volumeScale * 140); // Scale from 40 to 180
      }

      // EMA normalization: similar approach but more conservative
      let normalizedEma = 45;
      if (point.emaRatio > 0 && nonZeroEma.length > 0) {
        const minNonZeroEma = Math.min(...emaRatios.filter(v => v > 0));
        const emaScale = Math.min(point.emaRatio / maxEma, 1);
        normalizedEma = 45 + (emaScale * 100); // Scale from 45 to 145
      }

      // Fee normalization: use a larger band so small bps changes look like visible steps
      // Map fee to ~60-180 (fills most of chart height). Guard for flat series.
      let normalizedFee = 120;
      if (maxFee > minFee) {
        const feeScale = (point.dynamicFee - minFee) / (maxFee - minFee);
        normalizedFee = 60 + (feeScale * 120); // 60..180 band
      }

      return {
        name: index,
        volume: normalizedVolume,
        ema: normalizedEma,
        fee: normalizedFee,
        // keep original for change-point dots
        _origFee: point.dynamicFee,
      };
    });
    
    // Cache the new chart data
    previousChartDataRef.current = newChartData;
    return newChartData;
  }, [data, hasDataChanged]);

  // Removed change-point dots per design preference; keep normalization only

  const hasData = Array.isArray(data) && data.length > 0;

  // Render different Card structures based on data availability
  if (alwaysShowSkeleton) {
    return (
      <div
        className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow"
        onClick={handleClick}
        onMouseEnter={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = 'white';
        }}
        onMouseLeave={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = '';
        }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
          <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">DYNAMIC FEE TREND</h2>
                     <div className="flex items-center gap-3">
             {poolInfo && (
               <div className="flex items-center">
                 <div className="relative w-8 h-4">
                   <div className="absolute top-0 left-0 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token0Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token0Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                   <div className="absolute top-0 left-2.5 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token1Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token1Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                 </div>
                 <span className="text-xs text-muted-foreground">{poolInfo.token0Symbol}/{poolInfo.token1Symbol}</span>
               </div>
             )}
             <ArrowUpRight aria-hidden="true" data-arrow className="h-4 w-4 text-muted-foreground transition-colors duration-150" />
          </div>
        </div>
        <div className="px-2 pb-2 pt-2 h-[100px]">
          <div className="w-full h-full bg-muted/40 rounded animate-pulse" />
        </div>
        
      </div>
    );
  }

  // If no data and not loading, show the empty state. If loading, fall through to the chart card (it shows a skeleton inside).
  if (!hasData && !isLoading) {
    return (
      <div
        className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow"
        onClick={handleClick}
        onMouseEnter={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = 'white';
        }}
        onMouseLeave={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = '';
        }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
          <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">DYNAMIC FEE TREND</h2>
                     <div className="flex items-center gap-3">
             {poolInfo && (
               <div className="flex items-center">
                 <div className="relative w-8 h-4">
                   <div className="absolute top-0 left-0 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token0Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token0Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                   <div className="absolute top-0 left-2.5 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token1Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token1Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                 </div>
                 <span className="text-xs text-muted-foreground">{poolInfo.token0Symbol}/{poolInfo.token1Symbol}</span>
               </div>
             )}
             <ArrowUpRight aria-hidden="true" data-arrow className="h-4 w-4 text-muted-foreground transition-colors duration-150" />
          </div>
        </div>
        <div className="px-2 pb-2 pt-0 h-[120px]">
          <div className="w-full h-full flex items-center justify-center" />
        </div>
        
      </div>
    );
  } else {

    // Expand Y-axis domain to ensure all data is visible
    const effectiveMinValue = 20;
    const effectiveMaxValue = 200;

    return (
      <div
        className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow"
        onClick={handleClick}
        onMouseEnter={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = 'white';
        }}
        onMouseLeave={(e) => {
          const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement;
          if (arrow) arrow.style.color = '';
        }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
          <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">DYNAMIC FEE TREND</h2>
                     <div className="flex items-center gap-3">
             {poolInfo && (
               <div className="flex items-center">
                 <div className="relative w-8 h-4">
                   <div className="absolute top-0 left-0 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token0Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token0Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                   <div className="absolute top-0 left-2.5 w-4 h-4 rounded-full overflow-hidden bg-background border border-border/50">
                     <Image 
                       src={getToken(poolInfo.token1Symbol)?.icon || "/placeholder-logo.svg"} 
                       alt={poolInfo.token1Symbol} 
                       width={16} 
                       height={16} 
                       className="w-full h-full object-cover" 
                     />
                   </div>
                 </div>
                 <span className="text-xs text-muted-foreground">{poolInfo.token0Symbol}/{poolInfo.token1Symbol}</span>
               </div>
             )}
             <ArrowUpRight aria-hidden="true" data-arrow className="h-4 w-4 text-muted-foreground transition-colors duration-150" />
          </div>
        </div>
        <div className="px-2 pb-2 pt-0 h-[100px]">
          <div className="w-full h-full cursor-pointer [&_.recharts-wrapper]:outline-none [&_.recharts-wrapper]:focus:outline-none [&_.recharts-surface]:outline-none">
            {showLoadingSkeleton ? (
              <div className="w-full h-[92px] bg-muted/40 rounded animate-pulse mt-2"></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={chartData || []}
                  margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
                  style={{ cursor: 'pointer' }}
                >
                  <XAxis dataKey="name" hide={true} />
                  <YAxis 
                    hide={true} 
                    domain={[effectiveMinValue, effectiveMaxValue]}
                  />
                  <Line
                    type="monotone"
                    dataKey="volume"
                    stroke={"hsl(var(--chart-3))"}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ema"
                    stroke={"hsl(var(--chart-2))"}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    activeDot={false}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="fee"
                    stroke={"#e85102"}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        
      </div>
    );
  }
}

// Memoized export to prevent unnecessary re-renders
export const DynamicFeeChartPreview = React.memo(DynamicFeeChartPreviewComponent);