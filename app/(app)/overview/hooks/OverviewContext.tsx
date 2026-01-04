"use client";

import React, { createContext, useContext } from "react";

/**
 * Overview filter context interface
 */
interface OverviewFilterContextValue {
  activeTokenFilter: string | null;
  setActiveTokenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isStickyHover: boolean;
  setIsStickyHover: React.Dispatch<React.SetStateAction<boolean>>;
  hoverTokenLabel?: string | null;
}

/**
 * Overview filter context for token filtering across components
 */
export const OverviewFilterContext = createContext<OverviewFilterContextValue>({
  activeTokenFilter: null,
  setActiveTokenFilter: (() => {}) as React.Dispatch<React.SetStateAction<string | null>>,
  isStickyHover: false,
  setIsStickyHover: (() => {}) as React.Dispatch<React.SetStateAction<boolean>>,
  hoverTokenLabel: null,
});

/**
 * Hook to access overview filter context
 */
export function useOverviewFilter() {
  return useContext(OverviewFilterContext);
}

/**
 * Loading phases for skeleton system
 */
export type LoadPhases = { phase: 0 | 1 | 2 | 3; startedAt: number };

/**
 * Readiness state interface
 */
export type Readiness = {
  core: boolean;    // positions, balances loaded
  prices: boolean;  // price map available
  apr: boolean;     // APR calculations done
};

/**
 * Token balance interface
 */
export interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

/**
 * Overview data interface
 */
export interface OverviewData {
  totalValue: number;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error?: string;
  priceMap: Record<string, number>;
  pnl24hPct: number;
  priceChange24hPctMap: Record<string, number>;
}

/**
 * Composition segment interface for portfolio visualization
 */
export interface CompositionSegment {
  label: string;
  pct: number;
  color: string;
}

/**
 * Skeleton visibility state
 */
interface SkeletonVisibility {
  header: boolean;
  table: boolean;
  charts: boolean;
  actions: boolean;
}

/**
 * Multi-phase skeleton loading orchestration hook
 * Controls the staggered reveal of UI elements as data becomes available
 */
export function useLoadPhases(readiness: Readiness): { phase: 0 | 1 | 2 | 3; showSkeletonFor: SkeletonVisibility } {
  const [phases, setPhases] = React.useState<LoadPhases>({ phase: 0, startedAt: Date.now() });
  const [showSkeletonFor, setShowSkeletonFor] = React.useState<SkeletonVisibility>({
    header: true,
    table: true,
    charts: true,
    actions: true,
  });

  React.useEffect(() => {
    const now = Date.now();
    const elapsed = now - phases.startedAt;
    const minShowTime = 350; // minimum skeleton visibility time
    const initialDelay = 100; // initial delay to avoid flicker

    // Determine target phase based on readiness
    let targetPhase: 0 | 1 | 2 | 3 = 0;
    if (readiness.core && readiness.prices) {
      targetPhase = 2; // core data ready
    }
    if (readiness.core && readiness.prices && readiness.apr) {
      targetPhase = 3; // APR ready (everything ready)
    }
    if (readiness.core || readiness.prices) {
      targetPhase = Math.max(targetPhase, 1) as 0 | 1 | 2 | 3; // at least show layout
    }

    // Only advance phases, never regress
    if (targetPhase > phases.phase) {
      setPhases({ phase: targetPhase, startedAt: phases.startedAt });
    }

    // Control skeleton visibility with staggered timing for smooth transitions
    const headerReady = targetPhase >= 3;
    const tableReady = targetPhase >= 2;

    if (elapsed >= minShowTime || targetPhase >= 3) {
      setShowSkeletonFor({
        header: !headerReady,
        table: !tableReady,
        charts: false,
        actions: false,
      });
    } else if (elapsed >= initialDelay) {
      setShowSkeletonFor({
        header: targetPhase < 2,
        table: targetPhase < 2,
        charts: false,
        actions: targetPhase < 2,
      });
    }
  }, [readiness, phases.phase, phases.startedAt]);

  return { phase: phases.phase, showSkeletonFor };
}
