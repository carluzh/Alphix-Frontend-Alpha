"use client"

import { AppLayout } from "@/components/app-layout"
import { SwapInterface } from "@/components/swap/swap-interface"
import { ScrollRevealTransactions } from "@/components/scroll-reveal-transactions"
import { StarrySkyBackground } from "@/components/StarrySkyBackground"
import type { Metadata } from 'next'
import React, { useState, useCallback, useEffect } from "react";
import { SwapRoute } from "@/lib/routing-engine";

export default function Page() {
  // State for multi-hop routing and fees, lifted from SwapInterface
  const [currentRoute, setCurrentRoute] = useState<SwapRoute | null>(null);
  const [selectedPoolIndexForChart, setSelectedPoolIndexForChart] = useState<number>(0);

  // Handler for selecting which pool's fee chart to display (passed down to SwapInputView)
  const handleSelectPoolForChart = useCallback((poolIndex: number) => {
    if (currentRoute && poolIndex >= 0 && poolIndex < currentRoute.pools.length) {
      setSelectedPoolIndexForChart(poolIndex);
    }
  }, [currentRoute]);

  // NEW: Add navigation handlers for chart preview (controlling selectedPoolIndexForChart)
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

  // REMOVED: showPreviousArrow and showNextArrow logic
  // const showPreviousArrow = currentRoute && currentRoute.pools.length > 1 && selectedPoolIndexForChart > 0;
  // const showNextArrow = currentRoute && currentRoute.pools.length > 1 && selectedPoolIndexForChart < currentRoute.pools.length - 1;

  return (
    <AppLayout>
      {/* Starry sky background - sits behind everything */}
      <StarrySkyBackground />
      
      <div className="flex flex-1 flex-col relative"> {/* Added relative positioning */}
        <div className="flex flex-1 justify-center py-10 md:py-16">
          <div className="w-full max-w-md px-4">
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
        {/* REMOVED: Independent Navigation Buttons */}
        {/*
        {showPreviousArrow && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-0 top-1/2 -translate-y-1/2 ml-4 h-10 w-10 text-muted-foreground hover:text-white transition-colors duration-150 z-20 md:ml-0"
            onClick={handlePreviousPool}
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </Button>
        )}
        {showNextArrow && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0 top-1/2 -translate-y-1/2 mr-4 h-10 w-10 text-muted-foreground hover:text-white transition-colors duration-150 z-20 md:mr-0"
            onClick={handleNextPool}
          >
            <ChevronRightIcon className="h-6 w-6" />
          </Button>
        )}
        */}
      </div>
    </AppLayout>
  )
} 