"use client";

import { useState, useEffect, useRef, PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { PortfolioHeader } from "./Header/Header";

/**
 * PortfolioLayout - Uniswap-style max-width with left alignment
 *
 * Uses the same outer structure as other pages:
 * - flex flex-1 flex-col for outer container
 * - p-3 sm:p-6 for responsive padding
 * - max-w-[1200px] matching Uniswap, but left-aligned (no mx-auto)
 */
export function PortfolioLayout({ children }: PropsWithChildren) {
  const { isConnected } = useAccount();
  const [scrollY, setScrollY] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track scroll position for header compaction
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col p-3 sm:p-6 overflow-x-hidden max-w-[1200px]"
    >
      {/* Connect Wallet Banner - shown when disconnected */}
      {!isConnected && (
        <div className="flex flex-col items-center justify-center py-8 px-4 rounded-2xl border border-sidebar-border bg-container/50 mb-4">
          <h2 className="text-lg font-medium text-foreground mb-2">
            Connect your wallet
          </h2>
          <p className="text-sm text-muted-foreground text-center">
            Connect your wallet to view your portfolio
          </p>
        </div>
      )}

      {/* Header with address display and tabs */}
      <PortfolioHeader scrollY={scrollY} />

      {/* Content Area - gap between header and content */}
      <div className="mt-10">
        {children}
      </div>
    </div>
  );
}

export default PortfolioLayout;
