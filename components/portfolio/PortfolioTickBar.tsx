"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface PortfolioTickBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  netApyRef: React.RefObject<HTMLDivElement | null>;
  layout?: "inline" | "block"; // inline: next to NET APY, block: full-width row
  handleRestClick: (segment: any, segmentIndex?: number) => void;
  setIsRestCycling: (value: boolean) => void;
  isRestCycling: boolean;
  restCycleIndex: number;
  forceHideLabels?: boolean;
  onApplySort?: () => void;
  onHoverToken?: (label: string | null) => void;
  activeTokenFilter?: string | null;
  setActiveTokenFilter?: React.Dispatch<React.SetStateAction<string | null>>;
}

export function PortfolioTickBar({ composition, onHover, hoveredSegment, containerRef, netApyRef, layout = "inline", handleRestClick, setIsRestCycling, isRestCycling, restCycleIndex, forceHideLabels, onApplySort, onHoverToken, activeTokenFilter, setActiveTokenFilter }: PortfolioTickBarProps) {
  const SMALL_SEGMENT_THRESHOLD = 10; // tweakable (e.g., 5)
  const selectedIdx = activeTokenFilter
    ? (() => {
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;
  const hoverIdx = hoveredSegment;
  // Hide inline labels entirely for placeholder/empty states (no wallet, 0 positions)
  const hideAllInlineLabels = React.useMemo(() => {
    if (forceHideLabels) return true;
    return composition.length === 1 && (composition[0] as any)?.label === 'All' && Math.round((composition[0] as any)?.pct || 0) === 100;
  }, [composition, forceHideLabels]);
  
  // Check if Rest segment should be highlighted when cycling
  const isRestSegmentHighlighted = (segmentIdx: number) => {
    if (!isRestCycling) return false;
    const segment = composition[segmentIdx];
    return segment?.label === 'Rest';
  };
  // Precise text measurement for overflow decisions (10px label font)
  const measureTextWidth = React.useCallback((text: string): number => {
    try {
      if (typeof document === 'undefined') return (text || '').length * 7;
      const anyDoc = document as any;
      const canvas: HTMLCanvasElement = anyDoc.__alphixMeasureCanvas || (anyDoc.__alphixMeasureCanvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return (text || '').length * 7;
      ctx.font = '10px ui-sans-serif';
      return ctx.measureText(text || '').width;
    } catch {
      return (text || '').length * 7;
    }
  }, []);
  const hoverColor = '#f45502';
  const selectedColor = hoverColor;
  const rootRef = useRef<HTMLDivElement>(null);
  const [maxTicks, setMaxTicks] = useState(200); // Default fallback
  const [tickPixelWidth, setTickPixelWidth] = useState<number>(2);
  const [tickGapWidth, setTickGapWidth] = useState<number>(4);
  const [availablePixels, setAvailablePixels] = useState<number>(0);
  const lastPerTickRef = useRef<number | null>(null);
  const lastTicksRef = useRef<number | null>(null);

  useEffect(() => {
    const calculateMaxTicks = () => {
      if (containerRef.current && netApyRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const netApyRect = netApyRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const paddingBlock = viewportWidth <= 1500 ? 32 : 44; // safe padding for block layout only
        
        // Prefer measuring the component's parent width directly for inline layout
        let availableInline = 0;
        if (layout !== "block") {
          const parentWidth = rootRef.current?.parentElement?.getBoundingClientRect().width || 0;
          if (parentWidth > 0) {
            availableInline = Math.max(0, parentWidth);
          }
        }
        // Fallback to previous cross-column measurement
        if (availableInline === 0) {
          if (layout === "block" || containerRef.current === netApyRef.current) {
            // block layout: keep a small safety padding
            availableInline = Math.max(0, containerRect.width - paddingBlock);
          } else {
            // inline layout: no extra padding so we fill full available space
            availableInline = Math.max(0, (containerRect.right - netApyRect.right));
          }
        }

        const calcForAvailable = (avail: number) => {
          // FIXED sizing - never change these values
          const px = 2;
          const gap = 4;
          const perTick = px + gap;
          let ticks = Math.floor(avail / perTick);
          
          // For mobile block layout, use a reasonable number
          if (layout === "block") {
            ticks = Math.min(60, Math.max(40, ticks)); // Between 40-60 ticks for mobile
          }
          
          const clampedTicks = Math.max(12, Math.min(300, ticks)); // Increased to better show small percentages
          const rowWidth = clampedTicks * px + Math.max(0, (clampedTicks - 1)) * gap;
          return { px, gap, perTick, ticks: clampedTicks, rowWidth };
        };

        const result = calcForAvailable(availableInline);

        setTickPixelWidth(result.px);
        setTickGapWidth(result.gap);
        setMaxTicks(result.ticks);
        setAvailablePixels(availableInline);

        lastPerTickRef.current = result.perTick;
        lastTicksRef.current = result.ticks;
      }
    };

    // Multiple calculations to ensure proper initial sizing
    calculateMaxTicks();
    const timeoutId1 = setTimeout(calculateMaxTicks, 10);
    const timeoutId2 = setTimeout(calculateMaxTicks, 100);
    
    window.addEventListener('resize', calculateMaxTicks);
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      window.removeEventListener('resize', calculateMaxTicks);
    };
  }, [containerRef, netApyRef, layout]);

  const total = composition?.reduce((a, b) => a + b.pct, 0) || 1;
  const segments = composition?.map((c) => ({ ...c, pct: (c.pct / total) * 100 })) || [];
  // Ensure every segment can display at least a percentage label (~24px)
  const minLabelPx = 24;
  const minTicksPerSegment = Math.max(1, Math.ceil(minLabelPx / (tickPixelWidth + tickGapWidth)));
  // Compute the theoretical ticks required if every segment had min ticks
  const requiredTicksForLabels = segments.length * minTicksPerSegment;
  // Prefer maxTicks, but if segments are many, expand ticks so labels fit; scaling is fine per user spec
  const ticks = Math.max(maxTicks, requiredTicksForLabels);
  const totalRowWidth = ticks * tickPixelWidth + Math.max(0, (ticks - 1)) * tickGapWidth;
  // In block layout, scale to exactly the container width; in inline, only shrink if needed.
  const scaleX = (() => {
    if (totalRowWidth <= 0) return 1;
    if (layout === "block") {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? totalRowWidth;
      // Ensure we don't exceed container width by adding some padding
      const maxWidth = Math.max(containerWidth - 32, 100); // 32px padding to prevent overflow
      return Math.min(1, maxWidth / totalRowWidth);
    }
    if (availablePixels > 0) {
      // Always scale to exactly fill available inline width (grow or shrink)
      return availablePixels / totalRowWidth;
    }
    return 1;
  })();

  // Compute integer tick spans per segment, ensuring minimum ticks for percentage display
  const minTicksForPct = minTicksPerSegment; // baseline minimum
  const minLabelPxSmall = 34; // ensure space for small "%" label comfortably
  const perTickPx = (tickPixelWidth + tickGapWidth);
  const baseMinTicksForSmall = Math.max(1, Math.ceil(minLabelPxSmall / perTickPx));
  const minTicksForSmall = Math.max(1, baseMinTicksForSmall - 1); // shorter by one tick
  
  // Establish per-segment minimums (tiny non-OTHERS get larger floor)
  const minTicksPerSegmentArr = segments.map((s) => {
    const isSmallNonRest = (s.pct < 5) && (String(s.label) !== 'Rest');
    return isSmallNonRest ? Math.max(minTicksForSmall, minTicksForPct) : minTicksForPct;
  });

  // Initial spans respecting minimums
  const rawSpans = segments.map((s, i) => {
    const proportionalTicks = Math.round((s.pct / 100) * ticks);
    return Math.max(minTicksPerSegmentArr[i], proportionalTicks);
  });

  let spanSum = rawSpans?.reduce((a, b) => a + b, 0) || 0;

  if (spanSum > ticks) {
    // Reduce from largest segments first, but never below their own minimums
    let excess = spanSum - ticks;
    const candidates = rawSpans
      ?.map((span, i) => ({ i, span }))
      ?.filter(({ i, span }) => span > minTicksPerSegmentArr?.[i])
      ?.sort((a, b) => b.span - a.span) || [];
    while (excess > 0 && candidates.length > 0) {
      for (let k = 0; k < candidates.length && excess > 0; k += 1) {
        const idx = candidates[k].i;
        if (rawSpans?.[idx] > minTicksPerSegmentArr?.[idx]) {
          rawSpans[idx] -= 1;
          excess -= 1;
        }
      }
      // Refilter in case some segments reached their minimums
      for (let k = candidates.length - 1; k >= 0; k -= 1) {
        const idx = candidates[k].i;
        if (rawSpans?.[idx] <= minTicksPerSegmentArr?.[idx]) candidates.splice(k, 1);
      }
    }
    spanSum = rawSpans?.reduce((a, b) => a + b, 0) || 0;
  } else if (spanSum < ticks) {
    const deficit = ticks - spanSum;
    const sortedIndices = rawSpans?.map((_, i) => i).sort((a, b) => (rawSpans?.[b] || 0) - (rawSpans?.[a] || 0)) || [];
    for (let i = 0; i < deficit; i++) {
      if (rawSpans?.[sortedIndices[i % sortedIndices.length]]) {
        rawSpans[sortedIndices[i % sortedIndices.length]] += 1;
      }
    }
    spanSum = rawSpans?.reduce((a, b) => a + b, 0) || 0;
  }

  // Compute starting tick index for each segment
  const segmentStarts: number[] = [];
  {
    let cursor = 0;
    for (let i = 0; i < (rawSpans?.length || 0); i += 1) {
      segmentStarts.push(cursor);
      cursor += rawSpans?.[i] || 0;
    }
  }

  // Precompute tick colors and segment indices aligned to spans
  const tickColors: string[] = new Array(ticks);
  const tickSegments: number[] = new Array(ticks);
  {
    let cursor = 0;
    for (let i = 0; i < (segments?.length || 0); i += 1) {
      const span = rawSpans?.[i] || 0;
      const color = segments?.[i]?.color || '#666';
      for (let j = 0; j < span; j += 1) {
        if (cursor + j < ticks) {
          tickColors[cursor + j] = color;
          tickSegments[cursor + j] = i;
        }
      }
      cursor += span;
    }
  }

  // Shorten next segment-start tick if hovered/selected label text would overflow into it
  const shortStartTicks = React.useMemo(() => {
    // This feature is disabled as inline labels no longer appear on hover for small segments.
    return new Set<number>();
  }, []);

  const isMeasured = layout === 'block' ? true : (availablePixels > 0);

  // Early return if no segments or required data
  if (!segments || segments.length === 0) {
    return (
      <React.Fragment>
        <div className="h-8 w-full" />
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
    <div
      ref={rootRef}
      className={layout === "block" ? "w-full" : ""}
      style={{
        width: layout === 'block' ? '100%' : (isMeasured ? `${availablePixels}px` : 0),
      }}
    >
      <div
        className="relative"
        style={{
          width: layout === "block" ? "100%" : totalRowWidth,
          transform: layout === "block" ? `translateY(3px)` : `scaleX(${isMeasured ? scaleX : 0})`,
          transformOrigin: layout === "block" ? "left center" : "right center",
          willChange: 'transform',
          opacity: isMeasured ? 1 : 0,
        }}
      >
        {/* Large hover zones for each segment (cover ticks + label area) */}
        <div className="absolute left-0 top-0 z-50" style={{ pointerEvents: (segments.length === 1 && (segments[0] as any)?.label === 'All') ? 'none' : 'auto', width: layout === 'block' ? '100%' : totalRowWidth, height: '2rem' }}>
          {segments.map((segment, segmentIndex) => {
            const pctRounded = Math.round(segment.pct);
            const isRest = segment.label === 'Rest';
            // Custom widened small segment: exactly those with boosted minimum ticks
            const isCustomSmallWidened = (minTicksPerSegmentArr?.[segmentIndex] > minTicksForPct) && !isRest;

            // Determine if the segment label is hidden in inline view (percentage-only)
            const spanTicks = rawSpans?.[segmentIndex] || 0;
            const segmentPxWidth = spanTicks * tickPixelWidth + Math.max(0, spanTicks - 1) * tickGapWidth;
            const leftPadForLabel = Math.max(0, tickPixelWidth - 1);
            const availableLabelWidthInline = Math.max(0, segmentPxWidth - leftPadForLabel);
            const restTokenInline = (segment as any)?.restTokens?.[restCycleIndex];
            const isRestHighlightedInline = isRestSegmentHighlighted(segmentIndex);
            const labelTextInline = (isRestHighlightedInline && restTokenInline ? restTokenInline.label : (segment as any).label) as string;
            const estNameWidthInline = measureTextWidth(labelTextInline || '');
            const estPctWidthInline = measureTextWidth(`${pctRounded}%`);
            const minGapInline = 6;
            const barSafetyEarlyInline = 4;
            const nameHiddenInline = availableLabelWidthInline < (estPctWidthInline + minGapInline + estNameWidthInline + barSafetyEarlyInline);

            // Overlay geometry: inline uses pixel math (with parent transform), block uses percentages (no transform stretch per tick)
            const segLeftPx = (segmentStarts?.[segmentIndex] || 0) * (tickPixelWidth + tickGapWidth);
            const segWidthPx = segmentPxWidth;
            const segLeftPct = ((segmentStarts?.[segmentIndex] || 0) / ticks) * 100;
            const segWidthPct = ((rawSpans?.[segmentIndex] || 0) / ticks) * 100;
            const zoneStyle: React.CSSProperties = layout === 'block'
              ? { left: `${segLeftPct}%`, width: `${segWidthPct}%`, height: '100%', cursor: 'pointer' }
              : { left: `${segLeftPx}px`, width: `${segWidthPx}px`, height: '100%', cursor: 'pointer' };

            const zone = (
              <div
                key={`hover-zone-${segmentIndex}`}
                className="absolute top-0"
                style={zoneStyle}
                onMouseEnter={() => { if (!(segments.length === 1 && (segments[0] as any)?.label === 'All')) { onHover(segmentIndex); try { onHoverToken?.(segment.label === 'Rest' ? 'Rest' : segment.label); } catch {} } }}
                onMouseLeave={() => { if (!(segments.length === 1 && (segments[0] as any)?.label === 'All')) { onHover(null); try { onHoverToken?.(null); } catch {} } }}
                onClick={() => {
                  if (segment.label === 'Rest') {
                    handleRestClick(segment, segmentIndex);
                  } else {
                    setActiveTokenFilter?.((activeToken) => (activeToken?.toUpperCase?.() === segment.label?.toUpperCase?.() ? null : segment.label));
                    setIsRestCycling(false);
                    try { onApplySort?.(); } catch {}
                  }
                }}
              />
            );
            // For wide (inline) tick visual: show tooltip when name is hidden or for REST (but not in forced-hide state)
            if (layout !== 'block' && !hideAllInlineLabels && (isRest || nameHiddenInline)) {
              return (
                <Tooltip key={`hover-zone-wrap-${segmentIndex}`} open={hoverIdx === segmentIndex}>
                  <TooltipTrigger asChild>{zone}</TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs" style={{ pointerEvents: 'none' }}>
                    {isRest ? (
                      <div className="space-y-1">
                        {(segment as any).restTokens?.map((token: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center gap-2">
                            <span className="flex items-center gap-1 uppercase">
                              {isRestCycling && (segment as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                                <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                              ) : (
                                <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                              )}
                              {token.label}
                            </span>
                            <span>{Math.round(token.pct)}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      `${pctRounded}% ${labelTextInline}`
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return zone;
          })}
        </div>
        {/* Tick row */}
        <div
          className="flex h-8 select-none"
          style={{
            gap: layout === "block" ? "2px" : `${tickGapWidth}px`,
            width: layout === "block" ? "100%" : totalRowWidth,
            justifyContent: layout === "block" ? "justify-between" : "flex-start"
          }}
        >
          {Array.from({ length: ticks }).map((_, i) => {
            const segmentIndex = tickSegments?.[i] ?? 0;
            const isHovered = hoverIdx === segmentIndex;
            const isSelected = selectedIdx === segmentIndex;
            return (
              <div
                key={i}
                className="h-full flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  backgroundColor: (segments.length === 1 && (segments[0] as any)?.label === 'All') ? (tickColors?.[i] || '#666') : (isHovered ? hoverColor : (isSelected ? selectedColor : (isRestSegmentHighlighted(segmentIndex) ? selectedColor : (tickColors?.[i] || '#666')))),
                  opacity: 0.9,
                }}
                onClick={() => {
                  const segment = composition?.[segmentIndex];
                  if (!segment) return;

                  if (segment.label === 'Rest') {
                    handleRestClick(segment, segmentIndex);
                  } else {
                    setActiveTokenFilter?.((activeToken) => {
                      const next = segment.label || null;
                      if (!next) return null;
                      return activeToken?.toUpperCase?.() === next.toUpperCase?.() ? null : next;
                    });
                    setIsRestCycling(false);
                  }
                }}
              />
            );
          })}
        </div>
        {/* Segment start markers extending downward */}
        <div
          className="pointer-events-none absolute left-0 top-0 flex"
          style={{
            height: "calc(100% + 12px)",
            gap: `${tickGapWidth}px`,
            width: layout === "block" ? "100%" : totalRowWidth,
            justifyContent: layout === "block" ? "space-between" : "flex-start"
          }}
        >
          {Array.from({ length: ticks }).map((_, i) => {
            const isSegmentStart = segmentStarts?.includes(i) || false;
            const segmentIndex = tickSegments?.[i] ?? 0;
            const isHovered = hoverIdx === segmentIndex;
            const isSelected = selectedIdx === segmentIndex;

            // Enhanced first marker visibility
            const isFirstMarker = false;
            const markerHeight = shortStartTicks.has(i) ? `calc(100% - 12px)` : "100%";
            const markerOpacity = 0.95;

            return isSegmentStart ? (
              <div
                key={`marker-${i}`}
                className="flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  height: markerHeight,
                  backgroundColor: (segments.length === 1 && (segments[0] as any)?.label === 'All') ? (tickColors?.[i] || '#666') : (isHovered ? hoverColor : (isSelected ? selectedColor : (isRestSegmentHighlighted(segmentIndex) ? selectedColor : (tickColors?.[i] || '#666')))),
                  opacity: markerOpacity
                }}
              />
            ) : (
              <div key={`marker-${i}`} className="flex-shrink-0" style={{ width: `${tickPixelWidth}px`, height: 0 }} />
            );
          })}
        </div>
      </div>
        {/* Labels aligned to segment-start ticks */}
        {layout === "block" ? (
          <div
            className="flex text-xs mt-0"
            style={{
              gap: "2px",
              width: "100%",
              justifyContent: "space-between",
              position: "relative",
              height: "20px",
              transform: 'translateY(3px)',
              willChange: 'transform',
              pointerEvents: 'none'
            }}
          >
            {(() => {
              const slots: React.ReactNode[] = [];
              for (let tickIdx = 0; tickIdx < ticks; tickIdx += 1) {
                const segIdx = segmentStarts.indexOf(tickIdx);
                const slot = (
                  <div key={`lbl-slot-${tickIdx}`} className="flex-shrink-0 relative" style={{ width: `${tickPixelWidth}px`, height: "100%" }}>
                    {segIdx !== -1 && (() => {
                      const s = segments[segIdx];
                      const restToken = (s as any)?.restTokens?.[restCycleIndex];
                      const isRestHighlighted = isRestSegmentHighlighted(segIdx);
                      const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
                      const isHovered = hoverIdx === segIdx;
                      const isSelected = selectedIdx === segIdx;
                      const startTick = segmentStarts[segIdx];
                      const spanTicks = rawSpans[segIdx];
                      const segmentPxWidth = spanTicks * tickPixelWidth + Math.max(0, spanTicks - 1) * tickGapWidth;
                      const leftPad = Math.max(0, tickPixelWidth - 1); // tighter gap to ticks
                      const availableLabelWidth = Math.max(0, segmentPxWidth - leftPad);
                      const labelText = (isRestHighlighted && restToken ? (restToken as any).label : (s as any).label) as string;
                      const estNameWidth = measureTextWidth(labelText || '');
                      const estPctWidth = measureTextWidth(`${pctRounded}%`);
                      const minGap = 6;
                      const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
                      // Hide names for placeholder composition (single 100% segment)
                      const hideAllLabels = (segments.length === 1 && (segments[0] as any)?.label === 'All' && Math.round((segments[0] as any)?.pct || 0) === 100) || forceHideLabels;
                      let showName = !hideAllLabels;
                      const fits = availableLabelWidth >= estPctWidth + minGap + estNameWidth + barSafetyEarly;
                      if (showName && !fits) {
                        // allow overflow on hover/selected; otherwise hide
                        if (!(isHovered || isSelected)) {
                          showName = false;
                        }
                      }
                      // Force show on hover or selected (allow overflow)
                      if (isHovered || isSelected) showName = true;
                      const color = isHovered ? hoverColor : ((isSelected || isRestHighlighted) ? selectedColor : (s as any).color);
                      return (
                        <div
                          className="absolute left-0 top-0"
                          onClick={() => {
                            if ((s as any).label === 'Rest') {
                              handleRestClick(s as any, segIdx);
                            } else {
                              setActiveTokenFilter?.((activeToken) => (activeToken?.toUpperCase?.() === (s as any).label?.toUpperCase?.() ? null : ((s as any).label as string)));
                              setIsRestCycling(false);
                            }
                          }}
                          style={{ paddingLeft: leftPad, width: `${segmentPxWidth}px`, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', zIndex: (isHovered || isSelected) ? 20 : undefined }}
                        >
                          <div className="flex items-baseline gap-1" style={{ overflow: (isHovered || isSelected) ? 'visible' : 'hidden' }}>
                            {(s as any).label === 'Rest' ? (
                              Array.isArray((s as any).restTokens) && (s as any).restTokens.length > 0 && (
                                <span className="font-medium" style={{ color, fontSize: 12 }}>
                                  {isRestCycling && (s as any).restTokens?.[restCycleIndex] ? 
                                    `${Math.round((s as any).restTokens[restCycleIndex].pct)}%` : 
                                    `+${(s as any).restTokens.length}`
                                  }
                                </span>
                              )
                            ) : (
                              <span className="font-medium" style={{ color }}>{hideAllLabels ? '' : `${pctRounded}%`}</span>
                            )}
                            {showName && (
                              <span className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" style={{ fontSize: 10, maxWidth: (isHovered || isSelected) ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', textOverflow: (isHovered || isSelected) ? 'clip' : 'ellipsis', textTransform: (s as any).label === 'Rest' ? 'none' : undefined }}>
                                {(s as any).label === 'Rest' ? (
                                  isRestCycling && (s as any).restTokens?.[restCycleIndex] ? 
                                    (s as any).restTokens[restCycleIndex].label : 
                                    'Assets'
                                ) : (
                                  labelText
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
                slots.push(slot);
              }
              return slots;
            })()}
          </div>
        ) : (
          <div
            className="relative text-xs"
            style={{
              marginTop: '0px',
              height: '20px',
              width: totalRowWidth,
              transform: `scaleX(${scaleX})`,
              transformOrigin: 'left center',
              willChange: 'transform',
              zIndex: 30
            }}
          >
            {(() => {
              const nodes: React.ReactNode[] = [];
              for (let i = 0; i < segments.length; i += 1) {
                const s = segments[i];
                const restToken = (s as any)?.restTokens?.[restCycleIndex];
                const isRestHighlighted = isRestSegmentHighlighted(i);
                const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
                const isHovered = hoverIdx === i;
                const isSelected = selectedIdx === i;
                const segmentStart = segmentStarts[i];
                const startPosition = segmentStart * (tickPixelWidth + tickGapWidth);
                const segmentPixelWidth = rawSpans[i] * tickPixelWidth + Math.max(0, rawSpans[i] - 1) * tickGapWidth;
                const leftPad = Math.max(0, tickPixelWidth - 1); // tighter gap to ticks
                const availableLabelWidth = Math.max(0, segmentPixelWidth - leftPad);
                const labelText = (isRestHighlighted && restToken ? (restToken as any).label : (s as any).label) as string;
                
                const isRest = (s as any).label === 'Rest';
                const isCycling = isRest && !!isRestCycling;
                const restArr = (s as any).restTokens as any[] | undefined;
                let percentText = '';
                if (!hideAllInlineLabels) {
                    if (isRest) {
                        if (isCycling && restArr?.[restCycleIndex]) {
                            const rt = restArr[restCycleIndex];
                            percentText = `${Math.round(rt?.pct ?? 0)}%`;
                        } else {
                            percentText = `+${restArr?.length || 0}`;
                        }
                    } else {
                        percentText = `${pctRounded}%`;
                    }
                }

                const estNameWidth = measureTextWidth(labelText || '');
                const estPctWidth = measureTextWidth(percentText);
                const minGap = 6;
                const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
                
                const fits = availableLabelWidth >= (estPctWidth + minGap + estNameWidth - barSafetyEarly);

                let showName = !hideAllInlineLabels && (s.pct >= 10) && fits;
                
                // Wide inline: force show name on hover/selected only if it fits
                if (!hideAllInlineLabels && (isHovered || isSelected) && fits) {
                  showName = true;
                }
              const content = isRest
                ? (
                  <div className="space-y-1">
                    {(s as any).restTokens?.map((token: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center gap-2">
                        <span className="flex items-center gap-1 uppercase">
                          {isRestCycling && (s as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                            <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                          ) : (
                            <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                          )}
                          {token.label}
                        </span>
                        <span>{Math.round(token.pct)}%</span>
                      </div>
                    ))}
                  </div>
                )
                : `${pctRounded}% ${labelText}`;
                
                const labelBody = (
                  <div 
                    key={`lbl-${i}`}
                    className="absolute top-0 cursor-pointer"
                    style={{ left: `${startPosition}px`, width: `${segmentPixelWidth}px`, paddingLeft: leftPad, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', zIndex: (isHovered || isSelected) ? 20 : undefined }}
                    onClick={() => {
                      if ((s as any).label === 'Rest') {
                        handleRestClick(s as any, i);
                      } else {
                        setActiveTokenFilter?.((activeToken) => (activeToken?.toUpperCase?.() === (s as any).label?.toUpperCase?.() ? null : ((s as any).label as string)));
                        setIsRestCycling(false);
                        try { onApplySort?.(); } catch {}
                      }
                    }}
                  >
                    <div className="flex items-baseline gap-1" style={{ overflow: (isHovered || isSelected) ? 'visible' : 'hidden' }}>
                      {hideAllInlineLabels ? null : (
                        (s as any).label === 'Rest'
                          ? (() => {
                              const restArr = (s as any).restTokens as any[] | undefined;
                              if (!Array.isArray(restArr) || restArr.length === 0) return null;
                              const isCycling = !!isRestCycling;
                              if (isCycling) {
                                const rt = restArr[restCycleIndex] as any;
                                const rp = Math.round(rt?.pct ?? 0);
                                return (
                                  <span className="font-medium" style={{ color: isHovered || isSelected ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color) }}>{`${rp}%`}</span>
                                );
                              }
                              return (
                                <span className="font-medium" style={{ color: isHovered || isSelected ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color), fontSize: 12 }}>{`+${restArr.length}`}</span>
                              );
                            })()
                          : (
                            <span className="font-medium" style={{ color: isHovered ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color) }}>{`${pctRounded}%`}</span>
                          )
                      )}
                      {showName && (() => {
                        const isRest = (s as any).label === 'Rest';
                        const restArrTmp = ((s as any).restTokens as any[] | undefined) || [];
                        const hasRest = Array.isArray(restArrTmp) && restArrTmp.length > 0;
                        const isCycling = isRest && !!isRestCycling && hasRest;
                        let nameText: string;
                        if (isRest) {
                          if (isCycling && hasRest) {
                            const maybe = (restArrTmp as any[])[restCycleIndex];
                            nameText = (maybe && maybe.label) ? String(maybe.label) : 'Assets';
                          } else {
                            nameText = 'Assets';
                          }
                        } else {
                          nameText = labelText;
                        }
                        const style: React.CSSProperties = {
                          fontSize: 10,
                          maxWidth: (isHovered || isSelected) ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`,
                          overflow: (isHovered || isSelected) ? 'visible' : 'hidden',
                          textOverflow: (isHovered || isSelected) ? 'clip' : 'ellipsis',
                          textTransform: isRest && !isCycling ? 'none' : undefined,
                        };
                        return (
                          <span className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" style={style}>
                            {nameText}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );

                // Do not wrap labels in tooltip to avoid hover flicker; tooltips are handled by the striped segment hover zones
                nodes.push(labelBody);
              }
              return nodes;
            })()}
          </div>
        )}
    </div>
    </React.Fragment>
  );
}


