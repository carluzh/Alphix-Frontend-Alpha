"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

/**
 * useShouldHeaderBeCompact - matches Uniswap's implementation exactly
 *
 * Uses hysteresis to prevent flickering:
 * - Scroll > 120px → compact = true
 * - Scroll < 60px → compact = false
 * - Between 60-120px → maintain previous state
 */
export function useShouldHeaderBeCompact(scrollY?: number): boolean {
  const { isConnected } = useAccount();
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (!isConnected || scrollY === undefined) {
      setIsCompact(false);
      return;
    }

    setIsCompact((prevIsCompact) => {
      if (!prevIsCompact && scrollY > 120) {
        return true;
      }
      if (prevIsCompact && scrollY < 60) {
        return false;
      }
      return prevIsCompact;
    });
  }, [scrollY, isConnected]);

  return isCompact;
}

export default useShouldHeaderBeCompact;
