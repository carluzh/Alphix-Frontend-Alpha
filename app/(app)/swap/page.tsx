"use client"

import { SwapInterface } from "@/components/swap/swap-interface"
import type { Metadata } from 'next'
import React, { useState, useCallback } from "react";
import { SwapRoute } from "@/lib/swap/routing-engine";

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
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 justify-center p-3 sm:p-6">
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