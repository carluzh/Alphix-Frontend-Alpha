"use client";

import React, { RefObject } from "react";
import { formatUSD, formatPercent } from "@/lib/format";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PortfolioTickBar } from "@/components/portfolio/PortfolioTickBar";
import { PortfolioHeaderSkeleton } from "./skeletons";

interface CompositionSegment {
  label: string;
  pct: number;
  color: string;
}

interface PortfolioHeaderProps {
  // Value display
  displayValue: number;
  pnl24hPct: number;
  isPlaceholderComposition: boolean;

  // Stats
  filteredPositionCount: number;
  effectiveAprPct: number | null;
  totalFeesUSD: number;

  // Asset allocation
  composition: CompositionSegment[];
  hoveredSegment: number | null;
  setHoveredSegment: (segment: number | null) => void;
  forceHideLabels: boolean;

  // Rest cycling
  handleRestClick: (segment: any, segmentIndex?: number) => void;
  setIsRestCycling: (value: boolean) => void;
  isRestCycling: boolean;
  restCycleIndex: number;

  // Token filter
  activeTokenFilter: string | null;
  setActiveTokenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredTokenLabel: (label: string | null) => void;

  // Refs
  containerRef: RefObject<HTMLDivElement | null>;
  netApyRef: RefObject<HTMLDivElement | null>;

  // Layout
  viewportWidth: number;
  isVerySmallScreen: boolean;
  isNarrowScreen: boolean;

  // Loading state
  showSkeleton: boolean;
}

/**
 * Portfolio header component - displays value, stats, and asset allocation
 * Extracted from page.tsx for modularity
 */
export function PortfolioHeader({
  displayValue,
  pnl24hPct,
  isPlaceholderComposition,
  filteredPositionCount,
  effectiveAprPct,
  totalFeesUSD,
  composition,
  hoveredSegment,
  setHoveredSegment,
  forceHideLabels,
  handleRestClick,
  setIsRestCycling,
  isRestCycling,
  restCycleIndex,
  activeTokenFilter,
  setActiveTokenFilter,
  setHoveredTokenLabel,
  containerRef,
  netApyRef,
  viewportWidth,
  isVerySmallScreen,
  isNarrowScreen,
  showSkeleton,
}: PortfolioHeaderProps) {
  if (showSkeleton) {
    return <PortfolioHeaderSkeleton viewportWidth={viewportWidth} />;
  }

  // Value change calculation
  const deltaUsd = (() => {
    try {
      const total = Number(displayValue) || 0;
      if (!Number.isFinite(pnl24hPct) || !isFinite(total)) return 0;
      return (total * pnl24hPct) / 100;
    } catch { return 0; }
  })();
  const isPositive = (pnl24hPct || 0) >= 0;
  const absDelta = Math.abs(deltaUsd);

  // Format header value with commas
  const formatUSDHeader = (num: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  // Render value change indicator
  const renderValueChange = () => (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">
        {isPositive ? '+' : '-'}{formatUSD(absDelta)}
      </span>
      <div className="flex items-center gap-1">
        {isPositive ? (
          <ArrowUpRight className="h-3 w-3 text-green-500" />
        ) : (
          <ArrowDownRight className="h-3 w-3 text-red-500" />
        )}
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`${isPositive ? 'text-green-500' : 'text-red-500'} font-medium cursor-default`}>
                {formatPercent(Math.abs(pnl24hPct || 0), { min: 2, max: 2 })}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
              24h Performance
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );

  // Render APR with tooltip for large values
  const renderApr = () => {
    if (isPlaceholderComposition) return '-';
    if (effectiveAprPct === null) return '—';
    if (effectiveAprPct > 999) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">&gt;999%</span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
              {formatPercent(effectiveAprPct, { min: 2, max: 2 })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return formatPercent(effectiveAprPct, { min: 1, max: 1 });
  };

  // Render tick bar for asset allocation
  const renderTickBar = (hideLabels: boolean) => (
    <div className="w-full pr-0 pl-2">
      <div className="relative">
        <PortfolioTickBar
          composition={isPlaceholderComposition
            ? [{ label: 'All', pct: 100, color: composition?.[0]?.color || 'hsl(0 0% 30%)' }]
            : composition
          }
          onHover={setHoveredSegment}
          hoveredSegment={hoveredSegment}
          containerRef={containerRef}
          netApyRef={netApyRef}
          handleRestClick={handleRestClick}
          setIsRestCycling={setIsRestCycling}
          isRestCycling={isRestCycling}
          restCycleIndex={restCycleIndex}
          forceHideLabels={hideLabels || isPlaceholderComposition}
          onApplySort={undefined}
          onHoverToken={setHoveredTokenLabel}
          activeTokenFilter={activeTokenFilter}
          setActiveTokenFilter={setActiveTokenFilter}
        />
      </div>
    </div>
  );

  // Desktop layout (3-column grid)
  if (viewportWidth > 1000) {
    return (
      <div
        ref={containerRef}
        className="grid items-start relative w-full"
        style={{
          gridTemplateColumns: viewportWidth > 1800
            ? "280px 280px 1fr"
            : viewportWidth > 1400
              ? "minmax(200px, 1fr) minmax(200px, 1fr) 2fr"
              : "minmax(200px, 1fr) 2fr",
          gridTemplateRows: "auto auto",
          columnGap: "1rem",
        }}
      >
        {/* Container 1: CURRENT VALUE */}
        <div className="col-[1] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between">
          <div>
            <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">CURRENT VALUE</h1>
            <div className={`${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
              {isPlaceholderComposition ? (
                <span className="text-muted-foreground">-</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="font-medium tracking-tight">{formatUSDHeader(displayValue)}</span>
                  {renderValueChange()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Container 2: Stats card (hidden below 1400px) */}
        <div
          ref={netApyRef}
          className={`col-[2] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 py-1.5 px-4 h-full flex flex-col justify-center ${viewportWidth <= 1400 ? 'hidden' : ''}`}
        >
          <div className="w-full divide-y divide-sidebar-border/40">
            <div className="flex justify-between items-center py-1.5">
              <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Positions</span>
              <span className="text-[11px] font-medium">{filteredPositionCount}</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Net APY</span>
              <span className="text-[11px] font-medium">{renderApr()}</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Fees</span>
              <span className="text-[11px] font-medium">{formatUSD(totalFeesUSD)}</span>
            </div>
          </div>
        </div>

        {/* Container 3: Asset Allocation */}
        <div className={`${viewportWidth > 1400 ? 'col-[3]' : 'col-[2]'} row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between`}>
          <div>
            <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">ASSET ALLOCATION</h1>
            <div className="flex-1 flex items-center justify-start">
              {renderTickBar(forceHideLabels)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mobile/Tablet layout (single card)
  return (
    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
      <div className="flex items-center justify-between gap-4">
        {/* Left: CURRENT VALUE */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">CURRENT VALUE</h1>
          <div className={`${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
            {isPlaceholderComposition ? (
              <span className="text-muted-foreground">-</span>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="font-medium tracking-tight">{formatUSDHeader(displayValue)}</span>
                {renderValueChange()}
              </div>
            )}
          </div>
        </div>

        {/* Right: metrics rows - hidden below 400px */}
        {!isNarrowScreen && (
          <div className="flex-none min-w-[140px]">
            <div className="space-y-2">
              <div className="flex justify-between items-center pl-4">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Positions</span>
                <span className="text-[11px] font-medium">{filteredPositionCount}</span>
              </div>
              <div className="flex justify-between items-center pl-4">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Net APY</span>
                <span className="text-[11px] font-medium">{renderApr()}</span>
              </div>
              <div className="flex justify-between items-center pl-4">
                <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Fees</span>
                <span className="text-[11px] font-medium">{formatUSD(totalFeesUSD)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PortfolioHeader;
