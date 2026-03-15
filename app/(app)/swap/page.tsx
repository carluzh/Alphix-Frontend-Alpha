"use client"

import { SwapInterface } from "@/components/swap/swap-interface"
import type { Metadata } from 'next'
import React, { useState, useCallback } from "react";
import { SwapRoute } from "@/lib/swap/routing-engine";

/** Six parallel dashed organic lines — dip in the middle, end higher than they start. */
function SwapBackgroundDecoration() {
  const S = 110; // vertical spacing between lines

  // Smooth paths — shifted down +200. Start lower-left, dip mid, end higher-right.
  const lines = [
    "M0,700 C300,740 600,880 900,960 S1500,880 1800,560 S2300,300 2400,300",
    "M0,810 C300,850 600,980 900,1020 S1500,940 1800,650 S2300,410 2400,410",
    "M0,920 C300,960 600,1070 900,1080 S1500,1000 1800,730 S2300,520 2400,520",
    "M0,1030 C300,1070 600,1160 900,1140 S1500,1050 1800,800 S2300,630 2400,630",
    "M0,1140 C300,1180 600,1250 900,1200 S1500,1100 1800,870 S2300,740 2400,740",
    "M0,1250 C300,1290 600,1330 900,1260 S1500,1150 1800,930 S2300,850 2400,850",
  ];


  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      <style>{`
        @keyframes swap-dash-flow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: 100; }
        }
      `}</style>
      <svg
        viewBox="0 0 2400 1200"
        preserveAspectRatio="none"
        className="w-full h-full"
        fill="none"
      >
        {lines.map((d, i) => {
          const dur = [25, 30, 35, 28, 33, 38][i];
          const dir = i % 2 === 1 ? "reverse" : "normal";
          return (
            <path
              key={i}
              d={d}
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="1"
              strokeDasharray="8 6"
              style={{
                animation: `swap-dash-flow ${dur}s linear infinite ${dir}`,
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function Page() {
  const [currentRoute, setCurrentRoute] = useState<SwapRoute | null>(null);
  const [selectedPoolIndexForChart, setSelectedPoolIndexForChart] = useState<number>(0);

  const handleSelectPoolForChart = useCallback((poolIndex: number) => {
    if (currentRoute && poolIndex >= 0 && poolIndex < currentRoute.pools.length) {
      setSelectedPoolIndexForChart(poolIndex);
    }
  }, [currentRoute]);

  const handleNextPool = useCallback(() => {
    if (currentRoute && selectedPoolIndexForChart < currentRoute.pools.length - 1) {
      setSelectedPoolIndexForChart(prevIndex => prevIndex + 1);
    }
  }, [currentRoute, selectedPoolIndexForChart]);

  const handlePreviousPool = useCallback(() => {
    if (currentRoute && selectedPoolIndexForChart > 0) {
      setSelectedPoolIndexForChart(prevIndex => prevIndex - 1);
    }
  }, [currentRoute, selectedPoolIndexForChart]);

  return (
    <div className="flex flex-1 flex-col relative overflow-hidden">
      <SwapBackgroundDecoration />
      <div className="flex flex-1 justify-center p-3 sm:p-6 relative z-10">
        <div className="w-full max-w-lg">
          <SwapInterface
            currentRoute={currentRoute}
            setCurrentRoute={setCurrentRoute}
            selectedPoolIndexForChart={selectedPoolIndexForChart}
            setSelectedPoolIndexForChart={setSelectedPoolIndexForChart}
            handleSelectPoolForChart={handleSelectPoolForChart}
          />
          <div id="swap-fee-hover-container" className="mt-2 flex justify-end pointer-events-none" />
        </div>
      </div>
    </div>
  )
} 