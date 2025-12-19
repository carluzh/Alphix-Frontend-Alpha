"use client"

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, ReferenceLine, Tooltip, ReferenceArea } from "recharts";
import { getToken, getPoolByTokens } from "@/lib/pools-config";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();

  // State to track if the content is stable and rendered
  const [isContentStable, setIsContentStable] = useState(false);

  // Loading state for chart data fetching
  const [isChartDataLoading, setIsChartDataLoading] = useState(false);

  // Loading skeleton flag (follows actual loading state)
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);

  // Use refs for animation tracking to avoid re-renders during animation
  const hasAnimatedRef = useRef(false);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hover state for tooltip
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Combined loading state - show skeleton when either parent isLoading or internal isChartDataLoading
  const isActuallyLoading = isLoading || isChartDataLoading;

  // Detect if parent data matches expected shape
  const isParentDataUsable = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return false;
    const first: any = data[0];
    return (
      typeof first?.timeLabel === 'string' &&
      typeof first?.volumeTvlRatio !== 'undefined' &&
      typeof first?.emaRatio !== 'undefined' &&
      typeof first?.dynamicFee !== 'undefined'
    );
  }, [Array.isArray(data) ? data.length : 0, (data as any)?.[0]?.timeLabel, (data as any)?.[0]?.volumeTvlRatio, (data as any)?.[0]?.emaRatio, (data as any)?.[0]?.dynamicFee]);

  // Auto-fetch only when no usable parent data is provided; endpoint handles caching
  const [autoData, setAutoData] = useState<FeeHistoryPoint[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        if (isParentDataUsable) return;
        if (!poolInfo?.token0Symbol || !poolInfo?.token1Symbol) return;
        const cfg = getPoolByTokens(poolInfo.token0Symbol, poolInfo.token1Symbol);
        const subgraphId = (cfg as any)?.subgraphId || (cfg as any)?.id;
        if (!subgraphId) return;

        // Check local cache with 60s TTL
        const cacheKey = `dynamicFeeChart_${subgraphId}_30days`;
        try {
          const cachedItem = sessionStorage.getItem(cacheKey);
          if (cachedItem) {
            const cached = JSON.parse(cachedItem);
            const now = Date.now();

            // Cache expires after 60 seconds (60,000 ms)
            if (cached.timestamp && (now - cached.timestamp) < 60000 && cached.data) {
              setAutoData(cached.data);
              return;
            } else {
              sessionStorage.removeItem(cacheKey); // Clean up expired cache
            }
          }
        } catch (error) {
          console.warn('Failed to load cached dynamic fee chart data:', error);
          sessionStorage.removeItem(cacheKey); // Clean up corrupted cache
        }

        setIsChartDataLoading(true);
        setShowLoadingSkeleton(true);

        const resp = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(String(subgraphId))}&days=30`);
        if (!resp.ok) return;
        const events = await resp.json();
        console.log('[DynamicFeeChart] Subgraph events:', events);
        if (!Array.isArray(events)) return;
        // Filter to last 30 days from today (not from oldest data)
        const nowSec = Math.floor(Date.now() / 1000);
        const thirtyDaysAgoSec = nowSec - (30 * 24 * 60 * 60);
        const evAsc = events
          .map((e: any) => ({
            ts: Number(e?.timestamp) || 0,
            feeBps: Number(e?.newFeeBps ?? e?.newFeeRateBps ?? 0),
            ratio: e?.currentRatio,    // Vol/TVL activity measurement (volatile, jumps around)
            ema: e?.newTargetRatio,    // EMA target (smooth, changes gradually)
          }))
          .filter((e: any) => e.ts >= thirtyDaysAgoSec) // Keep only last 30 days
          .sort((a: any, b: any) => a.ts - b.ts);
        const scaleRatio = (val: any): number => {
          const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0);
          if (!Number.isFinite(n)) return 0;
          if (Math.abs(n) >= 1e12) return n / 1e18;
          if (Math.abs(n) >= 1e6) return n / 1e6;
          if (Math.abs(n) >= 1e4) return n / 1e4;
          return n;
        };
        let out: FeeHistoryPoint[] = evAsc.map((e: any) => ({
          timeLabel: new Date(e.ts * 1000).toISOString().split('T')[0],
          volumeTvlRatio: scaleRatio(e.ratio),
          emaRatio: scaleRatio(e.ema),
          dynamicFee: (Number.isFinite(e.feeBps) ? e.feeBps : 0) / 10000,
        }));

        // Always show exactly 30 days - take the most recent 30 data points
        if (out.length > 30) {
          out = out.slice(-30);
        }
        
        // Cache the processed data
        if (out && out.length > 0) {
          try {
            const cacheData = {
              data: out,
              timestamp: Date.now()
            };
            sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
          } catch (error) {
            console.warn('Failed to cache dynamic fee chart data:', error);
          }
        }
        
        setAutoData(out);
      } catch {}
      finally {
        setIsChartDataLoading(false);
        setShowLoadingSkeleton(false);
      }
    })();
  }, [poolInfo?.token0Symbol, poolInfo?.token1Symbol, isParentDataUsable]);

  // No diffing. Keep this preview dead simple and render as soon as we have data

  // Keep skeleton visible exactly while loading (or when forced)
  useEffect(() => {
    setShowLoadingSkeleton(Boolean(alwaysShowSkeleton || isActuallyLoading));
  }, [isActuallyLoading, alwaysShowSkeleton]);

  const targetHref = useMemo(() => {
    if (!poolInfo) return null;
    const maybeCanonical = (poolInfo as any).id || (poolInfo as any).poolId;
    let targetId: string | undefined;
    if (maybeCanonical && !String(maybeCanonical).startsWith('0x')) {
      targetId = String(maybeCanonical);
    } else {
      const poolConfig = getPoolByTokens(poolInfo.token0Symbol, poolInfo.token1Symbol);
      if (poolConfig) targetId = poolConfig.id;
    }
    return targetId ? `/liquidity/${targetId}` : null;
  }, [poolInfo]);

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (!targetHref) return;
    if (typeof window !== 'undefined') {
      if (isMobile) {
        router.push(targetHref);
      } else {
        window.open(targetHref, '_blank', 'noopener,noreferrer');
      }
    } else {
      router.push(targetHref);
    }
  };

  // Build chart data from supplied series (preferred only if usable) or fetched fallback
  const effectiveData = isParentDataUsable ? data : (autoData || []);
  const effectiveCount = Array.isArray(effectiveData) ? effectiveData.length : 0;
  const hasMinimumData = effectiveCount >= 2;

  // Effect to signal when content is stable (avoid "top-down" partial paint on load)
  useEffect(() => {
    if (alwaysShowSkeleton) return;

    if (!isActuallyLoading && hasMinimumData) {
      const timer = setTimeout(() => {
        setIsContentStable(true);
        onContentStableChange?.(true);
      }, 50);
      return () => clearTimeout(timer);
    }

    if (isContentStable) {
      setIsContentStable(false);
      onContentStableChange?.(false);
    }
  }, [alwaysShowSkeleton, isActuallyLoading, hasMinimumData, isContentStable, onContentStableChange]);

  // Determine if we should animate: only on first render with data, using ref to avoid re-renders
  const shouldAnimate = !hasAnimatedRef.current && !isHovering;

  // Mark animation as complete after it finishes (using ref, no re-render)
  useEffect(() => {
    if (effectiveData && effectiveData.length > 0 && !hasAnimatedRef.current) {
      // Clear any existing timeout
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
      // Mark as animated after the animation duration
      animationTimeoutRef.current = setTimeout(() => {
        hasAnimatedRef.current = true;
      }, 650); // Slightly longer than animation duration (600ms)
    }

    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, [effectiveData]);

  // Removed in-chart CustomTooltip; using external portal container instead

  const chartData = useMemo(() => {
    // Return null if no data
    if (!effectiveData || effectiveData.length === 0) {
      return null;
    }

    // When data is available, render the full chart preview
    // Straight mapping: no normalization, 30-day window already applied
    const newChartData = effectiveData.map((point, index) => ({
      name: point?.timeLabel || `Point ${index}`,
      activity: Number(point?.volumeTvlRatio) || 0,
      target: Number(point?.emaRatio) || 0,
      fee: Number(point?.dynamicFee) || 0,
    }));


    return newChartData;
  }, [effectiveData]);

  // Lock fee Y-axis domain so viewport doesn't change on hover
  const feeYAxisDomain = useMemo(() => {
    if (!chartData || chartData.length === 0) return [0, 1] as [number, number];
    const fees = chartData
      .map((d) => (Number.isFinite(d.fee) ? Number(d.fee) : null))
      .filter((v): v is number => v !== null);
    if (fees.length === 0) return [0, 1] as [number, number];
    const min = Math.min(...fees);
    const max = Math.max(...fees);
    const pad = Math.max((max - min) * 0.1, 0.001);
    return [Math.max(0, min - pad), max + pad] as [number, number];
  }, [chartData]);

  // Build masked overlay data to color ONLY the hovered horizontal segment
  const overlaySegmentData = useMemo(() => {
    if (!chartData || hoveredIndex === null) return null;
    const lastIndex = chartData.length - 1;
    if (hoveredIndex < 0 || hoveredIndex >= lastIndex) return null;
    const hoveredFee = chartData[hoveredIndex]?.fee ?? null;
    const result = chartData.map((point, index) => {
      if (index === hoveredIndex) return { ...point, fee: hoveredFee };
      if (index === hoveredIndex + 1) return { ...point, fee: hoveredFee };
      return { ...point, fee: null };
    });
    return result;
  }, [chartData, hoveredIndex]);

  // Footer info: show only on hover
  const footerDisplay = useMemo(() => {
    if (!chartData || chartData.length === 0 || hoveredIndex === null) return null;
    const clampedIdx = Math.max(0, Math.min(hoveredIndex, chartData.length - 1));
    const point = chartData[clampedIdx];
    if (!point) return null;
    const pointName = point.name || `Point ${clampedIdx}`;
    const pointDate = new Date(String(pointName));
    const today = new Date();
    const daysAgo = Math.floor((today.getTime() - pointDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysAgoLabel = daysAgo === 0 ? "Today" : `${daysAgo}d ago`;
    const feeValue = Number(point.fee || 0);
    const pct = `${(feeValue < 0.1 ? feeValue.toFixed(3) : feeValue.toFixed(2))}%`;
    return { daysAgoLabel, pct };
  }, [chartData, hoveredIndex]);

  // Removed change-point dots per design preference; keep normalization only

    const hasData = Array.isArray(effectiveData) && effectiveCount > 0;
    const dataPointsCount = hasData ? effectiveCount : 0;

  // Render different Card structures based on data availability
  const Root: React.FC<React.PropsWithChildren<{ className: string }>> = ({ className, children }) => {
    if (!onClick && isMobile && targetHref) {
      return (
        <Link href={targetHref} prefetch className={`block ${className}`}>
          {children}
        </Link>
      );
    }
    return (
      <div className={className} onClick={handleClick}>
        {children}
      </div>
    );
  };

  if (alwaysShowSkeleton) {
    return (
      <Root className="w-full rounded-lg border border-primary transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow bg-container-secondary">
        <div className="flex items-center justify-between px-4 py-2 border-b border-primary">
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
        <div className="px-2 pb-2 pt-2 h-[100px] relative">
          <div className="w-full h-full bg-muted/40 rounded animate-pulse" />
        </div>
        
      </Root>
    );
  }

  // If insufficient data, keep the skeleton approach (avoid layout jumps / partial paints)
  if (!hasMinimumData) {
    return (
      <Root className="w-full rounded-lg border border-primary transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow bg-container-secondary">
        <div className="flex items-center justify-between px-4 py-2 border-b border-primary">
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
        <div className="px-2 pb-2 pt-2 h-[100px] relative">
          <div className="w-full h-full bg-muted/40 rounded animate-pulse" />
        </div>
        
      </Root>
    );
  } else {

    // Expand Y-axis domain to ensure all data is visible
    const effectiveMinValue: any = 'auto';
    const effectiveMaxValue: any = 'auto';

    return (
      <>
      <Root className="w-full rounded-lg border border-primary transition-colors overflow-hidden relative cursor-pointer group hover:shadow-lg transition-shadow bg-container-secondary">
        <div className="flex items-center justify-between px-4 py-2 border-b border-primary">
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
        <div className="px-2 py-2 h-[120px] relative">
          <div
            className="w-full h-full cursor-pointer [&_.recharts-wrapper]:outline-none [&_.recharts-wrapper]:focus:outline-none [&_.recharts-surface]:outline-none"
            onMouseMove={isMobile ? undefined : (e) => {
              // Calculate which data point based on mouse position
              if (chartData && chartData.length > 0) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const index = Math.floor(percentage * chartData.length);
                const clampedIndex = Math.max(0, Math.min(index, chartData.length - 1));
                setHoveredIndex(clampedIndex);
                setIsHovering(true);
              }
            }}
            onMouseLeave={isMobile ? undefined : () => {
              setHoveredIndex(null);
              setIsHovering(false);
            }}
          >
            {showLoadingSkeleton || !isContentStable ? (
              <div className="w-full h-full bg-muted/40 rounded flex items-center justify-center">
                <div className="animate-pulse">
                  <Image 
                    src="/LogoIconWhite.svg" 
                    alt="Loading" 
                    width={24} 
                    height={24} 
                    className="opacity-60"
                  />
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData || []}
                  margin={{ top: 0, right: 8, bottom: 0, left: 8 }}
                  style={{ cursor: 'pointer' }}
                  onMouseMove={isMobile ? undefined : (e: any) => {
                    if (e && e.activeTooltipIndex !== undefined && typeof e.activeTooltipIndex === 'number') {
                      setHoveredIndex(e.activeTooltipIndex);
                      setIsHovering(true);
                    }
                  }}
                  onMouseLeave={isMobile ? undefined : () => {
                    setHoveredIndex(null);
                    setIsHovering(false);
                  }}
                >
                  <XAxis dataKey="name" hide={true} />
                  <YAxis
                    yAxisId="left"
                    hide={true}
                    domain={[effectiveMinValue, effectiveMaxValue]}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    hide={true}
                    domain={feeYAxisDomain as any}
                  />
                  <defs>
                    <linearGradient id="hoverFeeShade" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--sidebar-primary)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--sidebar-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    content={() => null}
                    cursor={{ stroke: 'transparent', strokeWidth: 0 }}
                  />
                  {hoveredIndex !== null && chartData && hoveredIndex >= 0 && hoveredIndex < chartData.length - 1 && (
                    <ReferenceArea
                      x1={chartData[hoveredIndex]?.name}
                      x2={chartData[hoveredIndex + 1]?.name}
                      yAxisId="right"
                      y1={(feeYAxisDomain as any)[0] ?? 'auto'}
                      y2={chartData[hoveredIndex]?.fee}
                      fill="url(#hoverFeeShade)"
                      strokeOpacity={0}
                    />
                  )}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="activity"
                    stroke={"hsl(var(--chart-3))"}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={shouldAnimate}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="target"
                    stroke={"hsl(var(--chart-2))"}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={shouldAnimate}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                  {/* Base line: orange before hover, grey during hover */}
                  <Line
                    yAxisId="right"
                    type="stepAfter"
                    dataKey="fee"
                    stroke="var(--sidebar-primary)"
                    strokeWidth={1.5}
                    strokeOpacity={hoveredIndex === null ? 1 : 0.6}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={shouldAnimate}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />

                  {/* Highlight only the hovered horizontal segment using masked data */}
                  {overlaySegmentData && (
                    <Line
                      yAxisId="right"
                      type="stepAfter"
                      dataKey="fee"
                      data={overlaySegmentData}
                      stroke="var(--sidebar-primary)"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </Root>
      {/* Hover footer tooltip - separate container below chart card, right-aligned */}
      {!isMobile && footerDisplay && (
        <div className="mt-2 flex justify-end pointer-events-none">
          <div className="rounded-md border border-primary bg-container-secondary px-2.5 py-1.5 shadow-sm inline-flex">
            <div className="flex items-center gap-4 text-[10px] md:text-xs font-mono">
              <span className="text-muted-foreground">{footerDisplay.daysAgoLabel}</span>
              <span className="text-sidebar-primary font-medium">{footerDisplay.pct}</span>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }
}

// Memoized export to prevent unnecessary re-renders
export const DynamicFeeChartPreview = React.memo(DynamicFeeChartPreviewComponent);