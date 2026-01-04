"use client";

import { useState, useEffect, useRef, PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { OverviewHeader } from "./Header/Header";
import { OverviewConnectWalletBanner } from "./ConnectWalletBanner";

/**
 * OverviewLayout - Uniswap-style max-width with left alignment
 *
 * Consistent spacing throughout:
 * - Page padding: 12px mobile / 24px desktop (p-3 sm:p-6)
 * - All vertical gaps use the same spacing (gap-3 sm:gap-6)
 */
export function OverviewLayout({ children }: PropsWithChildren) {
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
      className="flex flex-col gap-3 sm:gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto"
    >
      {/* Connect Wallet Banner - shown when disconnected */}
      {!isConnected && <OverviewConnectWalletBanner />}

      {/* Header with address display and points */}
      <OverviewHeader scrollY={scrollY} />

      {/* Content Area */}
      {children}
    </div>
  );
}

export default OverviewLayout;
