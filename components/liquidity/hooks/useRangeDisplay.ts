/**
 * useRangeDisplay Hook
 *
 * Handles price range display calculations and formatting.
 * Extracts display logic from AddLiquidityForm for cleaner separation of concerns.
 *
 * Uses lib/liquidity utilities for tick/price conversions.
 */

import { useState, useEffect, useMemo } from 'react';
import { getPoolById } from '@/lib/pools-config';
import { getDecimalsForDenomination } from '@/lib/denomination-utils';
import { convertTickToPrice } from '@/lib/liquidity';
import { CalculatedLiquidityData } from './useAddLiquidityCalculation';

export interface UseRangeDisplayParams {
  tickLower: string;
  tickUpper: string;
  currentPoolTick: number | null;
  currentPrice: string | null;
  baseTokenForPriceDisplay: string;
  token0Symbol: string;
  token1Symbol: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  selectedPoolId?: string;
  activePreset: string | null;
  initialDefaultApplied: boolean;
  calculatedData: CalculatedLiquidityData | null;
}

export interface RangeDisplayResult {
  /** Formatted range labels for display { left, right } or null */
  rangeLabels: { left: string; right: string } | null;
  /** Formatted current price for display */
  formattedCurrentPrice: string | null;
  /** Min price input string */
  minPriceInputString: string;
  /** Max price input string */
  maxPriceInputString: string;
}

/**
 * Hook for calculating and formatting price range display values.
 */
export function useRangeDisplay(params: UseRangeDisplayParams): RangeDisplayResult {
  const {
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPrice,
    baseTokenForPriceDisplay,
    token0Symbol,
    token1Symbol,
    sdkMinTick,
    sdkMaxTick,
    selectedPoolId,
    activePreset,
    initialDefaultApplied,
    calculatedData,
  } = params;

  // State for price input strings
  const [minPriceInputString, setMinPriceInputString] = useState<string>('');
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>('');

  // Effect to update price input strings when underlying ticks or base display token changes
  useEffect(() => {
    const numTickLower = parseInt(tickLower);
    const numTickUpper = parseInt(tickUpper);

    // Early exit conditions
    if (currentPoolTick === null || currentPrice === null) {
      setMinPriceInputString('');
      setMaxPriceInputString('');
      return;
    }

    const tickRange = Math.abs(numTickUpper - numTickLower);
    if (
      (tickRange > 1000000 && activePreset !== 'Full Range') ||
      (!initialDefaultApplied && (numTickLower === sdkMinTick || numTickUpper === sdkMaxTick))
    ) {
      setMinPriceInputString('');
      setMaxPriceInputString('');
      return;
    }

    const isInvertedDisplay = baseTokenForPriceDisplay === token0Symbol;
    const rawApiLower = calculatedData?.priceAtTickLower
      ? parseFloat(calculatedData.priceAtTickLower)
      : null;
    const rawApiUpper = calculatedData?.priceAtTickUpper
      ? parseFloat(calculatedData.priceAtTickUpper)
      : null;

    // Calculate tick price with fallback using lib/liquidity utility
    const getTickPrice = (tick: number, apiPrice: number | null): number | null => {
      if (apiPrice !== null) return isInvertedDisplay ? 1 / apiPrice : apiPrice;
      if (isNaN(tick)) return null;
      // Use lib/liquidity utility for conversion
      const priceStr = convertTickToPrice({
        tick,
        currentPrice,
        currentPoolTick,
        baseToken: baseTokenForPriceDisplay,
        token0Symbol,
      });
      return priceStr ? parseFloat(priceStr) : null;
    };

    // For inverted display, lower tick = min display, upper tick = max display
    const valForMinInput = isInvertedDisplay
      ? getTickPrice(numTickLower, rawApiLower)
      : getTickPrice(numTickUpper, rawApiUpper);
    const valForMaxInput = isInvertedDisplay
      ? getTickPrice(numTickUpper, rawApiUpper)
      : getTickPrice(numTickLower, rawApiLower);

    // Format price value for display
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const displayDecimals = getDecimalsForDenomination(baseTokenForPriceDisplay, poolCfg?.type);
    const formatPrice = (val: number | null): string => {
      if (val === null || isNaN(val)) return '';
      if (val >= 0 && val < 1e-11) return '0';
      if (!isFinite(val) || val > 1e30) return '∞';
      return val.toFixed(displayDecimals);
    };

    setMinPriceInputString(formatPrice(valForMinInput));
    setMaxPriceInputString(formatPrice(valForMaxInput));
  }, [
    tickLower,
    tickUpper,
    baseTokenForPriceDisplay,
    token0Symbol,
    sdkMinTick,
    sdkMaxTick,
    calculatedData,
    activePreset,
    initialDefaultApplied,
    currentPoolTick,
    currentPrice,
    selectedPoolId,
  ]);

  // Calculate range labels for display
  const rangeLabels = useMemo((): { left: string; right: string } | null => {
    if (currentPoolTick === null || !currentPrice || !tickLower || !tickUpper) return null;
    const currentPriceNum = parseFloat(currentPrice);
    if (!isFinite(currentPriceNum) || currentPriceNum <= 0) return null;
    const lower = parseInt(tickLower);
    const upper = parseInt(tickUpper);
    if (isNaN(lower) || isNaN(upper)) return null;

    const shouldInvert = baseTokenForPriceDisplay === token0Symbol;
    // Use lib/liquidity utility for price calculation
    const priceAt = (tickVal: number): number => {
      const priceStr = convertTickToPrice({
        tick: tickVal,
        currentPrice,
        currentPoolTick,
        baseToken: baseTokenForPriceDisplay,
        token0Symbol,
      });
      return priceStr ? parseFloat(priceStr) : NaN;
    };

    // Full range case
    if (tickLower === sdkMinTick.toString() && tickUpper === sdkMaxTick.toString()) {
      return { left: '0.00', right: '∞' };
    }

    const pLower = priceAt(lower);
    const pUpper = priceAt(upper);

    const denomToken = shouldInvert ? token0Symbol : token1Symbol;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const decimals = getDecimalsForDenomination(denomToken, poolCfg?.type);

    const points = [
      { tick: lower, price: pLower },
      { tick: upper, price: pUpper },
    ].filter((p) => isFinite(p.price) && !isNaN(p.price));

    if (points.length < 2) return null;
    points.sort((a, b) => a.price - b.price);

    const formatVal = (v: number) => {
      if (!isFinite(v)) return '∞';
      const threshold = Math.pow(10, -decimals);
      if (v > 0 && v < threshold) return `<${threshold.toFixed(decimals)}`;
      const formatted = v.toLocaleString('en-US', {
        maximumFractionDigits: decimals,
        minimumFractionDigits: Math.min(2, decimals),
      });
      if (formatted === '0.00' && v > 0) return `<${threshold.toFixed(decimals)}`;
      return formatted;
    };

    return { left: formatVal(points[0].price), right: formatVal(points[1].price) };
  }, [
    currentPoolTick,
    currentPrice,
    tickLower,
    tickUpper,
    token0Symbol,
    token1Symbol,
    sdkMinTick,
    sdkMaxTick,
    baseTokenForPriceDisplay,
    selectedPoolId,
  ]);

  // Format current price for display
  const formattedCurrentPrice = useMemo(() => {
    if (!currentPrice) return null;
    const shouldInvert = baseTokenForPriceDisplay === token0Symbol;
    const denomToken = shouldInvert ? token0Symbol : token1Symbol;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const displayDecimals = getDecimalsForDenomination(denomToken, poolCfg?.type);
    const numeric = shouldInvert ? 1 / parseFloat(currentPrice) : parseFloat(currentPrice);
    if (!isFinite(numeric)) return '∞';
    return numeric.toLocaleString('en-US', {
      maximumFractionDigits: displayDecimals,
      minimumFractionDigits: Math.min(2, displayDecimals),
    });
  }, [currentPrice, baseTokenForPriceDisplay, token0Symbol, token1Symbol, selectedPoolId]);

  return {
    rangeLabels,
    formattedCurrentPrice,
    minPriceInputString,
    maxPriceInputString,
  };
}
