"use client"

import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, ReferenceLine, Tooltip, ReferenceArea } from "recharts";
import { getToken, getPoolByTokens } from "@/lib/pools-config";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { createPortal } from "react-dom";

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

  // Hover state for tooltip
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const el = document.getElementById('swap-fee-hover-container');
      setPortalEl(el as HTMLElement | null);
    }
  }, []);

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
        setShowLoadingSkeleton(true);
        const resp = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(String(subgraphId))}&days=30`);
        if (!resp.ok) return;
        const events = await resp.json();
        if (!Array.isArray(events)) return;
        // Filter to last 30 days from today (not from oldest data)
        const nowSec = Math.floor(Date.now() / 1000);
        const thirtyDaysAgoSec = nowSec - (30 * 24 * 60 * 60);
        const evAsc = events
          .map((e: any) => ({
            ts: Number(e?.timestamp) || 0,
            feeBps: Number(e?.newFeeBps ?? e?.newFeeRateBps ?? 0),
            ratio: e?.currentTargetRatio,
            // API returns oldTargetRatio (not newTargetRatio). Use oldTargetRatio; fallback to currentTargetRatio.
            ema: e?.oldTargetRatio ?? e?.currentTargetRatio,
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
        const out: FeeHistoryPoint[] = evAsc.map((e: any) => ({
          timeLabel: new Date(e.ts * 1000).toISOString().split('T')[0],
          volumeTvlRatio: scaleRatio(e.ratio),
          emaRatio: scaleRatio(e.ema),
          dynamicFee: (Number.isFinite(e.feeBps) ? e.feeBps : 0) / 10000,
        }));
        setAutoData(out);
      } catch {}
      finally {
        setShowLoadingSkeleton(false);
      }
    })();
  }, [poolInfo?.token0Symbol, poolInfo?.token1Symbol, isParentDataUsable]);


  // No diffing. Keep this preview dead simple and render as soon as we have data

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
      }, 1000);
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

    }
  };


  // Build chart data from supplied series (preferred only if usable) or fetched fallback
  const effectiveData = isParentDataUsable ? data : (autoData || []);

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

  const hasData = Array.isArray(effectiveData) && effectiveData.length > 0;

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
        <div className="px-2 pb-2 pt-2 h-[100px] relative">
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
        <div className="px-2 pb-2 pt-0 h-[120px] relative">
          <div className="w-full h-full flex items-center justify-center" />
        </div>
        
      </div>
    );
  } else {

    // Expand Y-axis domain to ensure all data is visible
    const effectiveMinValue: any = 'auto';
    const effectiveMaxValue: any = 'auto';

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
        <div className="px-2 pb-2 pt-0 h-[120px] relative">
          <div
            className="w-full h-full cursor-pointer [&_.recharts-wrapper]:outline-none [&_.recharts-wrapper]:focus:outline-none [&_.recharts-surface]:outline-none"
            onMouseMove={(e) => {
              // Calculate which data point based on mouse position
              if (chartData && chartData.length > 0) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                const index = Math.floor(percentage * chartData.length);
                const clampedIndex = Math.max(0, Math.min(index, chartData.length - 1));
                setHoveredIndex(clampedIndex);
              }
            }}
            onMouseLeave={() => {
              setHoveredIndex(null);
            }}
          >
            {showLoadingSkeleton && !hasData ? (
              <div className="w-full h-[92px] bg-muted/40 rounded animate-pulse mt-2"></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData || []}
                  margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
                  style={{ cursor: 'pointer' }}
                  onMouseMove={(e: any) => {
                    if (e && e.activeTooltipIndex !== undefined && typeof e.activeTooltipIndex === 'number') {
                      setHoveredIndex(e.activeTooltipIndex);
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredIndex(null);
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
                      <stop offset="0%" stopColor="#e85102" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#e85102" stopOpacity={0} />
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
                    isAnimationActive={false}
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
                    isAnimationActive={false}
                  />
                  {/* Base line: orange before hover, grey during hover */}
                  <Line
                    yAxisId="right"
                    type="stepAfter"
                    dataKey="fee"
                    stroke="#e85102"
                    strokeWidth={1.5}
                    strokeOpacity={hoveredIndex === null ? 1 : 0.6}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />

                  {/* Highlight only the hovered horizontal segment using masked data */}
                  {overlaySegmentData && (
                    <Line
                      yAxisId="right"
                      type="stepAfter"
                      dataKey="fee"
                      data={overlaySegmentData}
                      stroke="#e85102"
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
          {/* External portal for hover footer */}
          {portalEl && footerDisplay && createPortal(
            <div className="rounded-md border border-sidebar-border bg-[var(--token-container-background)] px-2.5 py-1.5 shadow-sm inline-flex">
              <div className="flex items-center gap-4 text-[10px] md:text-xs font-mono">
                <span className="text-muted-foreground">{footerDisplay.daysAgoLabel}</span>
                <span className="text-[#e85102] font-medium">{footerDisplay.pct}</span>
              </div>
            </div>,
            portalEl
          )}
        </div>
        
      </div>
    );
  }
}

// Memoized export to prevent unnecessary re-renders
export const DynamicFeeChartPreview = React.memo(DynamicFeeChartPreviewComponent);