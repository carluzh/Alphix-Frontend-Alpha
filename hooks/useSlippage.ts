/**
 * Slippage tolerance hooks with persistence
 * Based on Uniswap's implementation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SLIPPAGE_STORAGE_KEY,
  SLIPPAGE_AUTO_FLAG_KEY,
  DEFAULT_SWAP_SLIPPAGE,
  MAX_AUTO_SLIPPAGE_SAFE,
  MAX_CUSTOM_SLIPPAGE_TOLERANCE,
} from '@/lib/slippage/slippage-constants';

/**
 * Hook for managing user slippage tolerance with persistence
 */
export function useUserSlippageTolerance() {
  // Track if using auto or custom slippage
  const [isAuto, setIsAuto] = useState<boolean>(true);

  // Custom slippage value (only used when isAuto is false)
  const [customSlippage, setCustomSlippage] = useState<number>(DEFAULT_SWAP_SLIPPAGE);

  // Auto-slippage value (calculated or fetched)
  const [autoSlippage, setAutoSlippage] = useState<number>(DEFAULT_SWAP_SLIPPAGE);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedIsAuto = localStorage.getItem(SLIPPAGE_AUTO_FLAG_KEY);
      const savedSlippage = localStorage.getItem(SLIPPAGE_STORAGE_KEY);

      if (savedIsAuto !== null) {
        setIsAuto(savedIsAuto === 'true');
      }

      if (savedSlippage !== null) {
        const parsed = parseFloat(savedSlippage);
        if (!isNaN(parsed)) {
          setCustomSlippage(parsed);
        }
      }
    } catch (error) {
      console.error('[useUserSlippageTolerance] Error loading from localStorage:', error);
    }
  }, []);

  // Save to localStorage when values change
  useEffect(() => {
    try {
      localStorage.setItem(SLIPPAGE_AUTO_FLAG_KEY, isAuto.toString());
      localStorage.setItem(SLIPPAGE_STORAGE_KEY, customSlippage.toString());
    } catch (error) {
      console.error('[useUserSlippageTolerance] Error saving to localStorage:', error);
    }
  }, [isAuto, customSlippage]);

  // Get the current effective slippage
  const currentSlippage = useMemo(() => {
    return isAuto ? autoSlippage : customSlippage;
  }, [isAuto, autoSlippage, customSlippage]);

  // Set custom slippage and switch to custom mode
  const setSlippage = useCallback((value: number) => {
    // Cap at max custom tolerance
    const capped = Math.min(value, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
    setCustomSlippage(capped);
    setIsAuto(false);
  }, []);

  // Switch to auto mode
  const setAutoMode = useCallback(() => {
    setIsAuto(true);
  }, []);

  // Switch to custom mode with current value
  const setCustomMode = useCallback(() => {
    setIsAuto(false);
  }, []);

  // Update auto-slippage value (called when quote is received)
  const updateAutoSlippage = useCallback((value: number) => {
    // Cap at safe auto tolerance (5.0%), tighter than the 5.5% theoretical max
    const capped = Math.min(value, MAX_AUTO_SLIPPAGE_SAFE);
    setAutoSlippage(capped);
  }, []);

  return {
    currentSlippage,
    isAuto,
    customSlippage,
    autoSlippage,
    setSlippage,
    setAutoMode,
    setCustomMode,
    updateAutoSlippage,
  };
}
