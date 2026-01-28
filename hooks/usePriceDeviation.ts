/**
 * Hook to calculate price deviation between pool price and market price
 * Used for warning users when pool price differs significantly from external market price
 */

import { useMemo } from 'react';
import { useCoinGeckoPrices, calculateMarketPriceRatio } from './useCoinGeckoPrice';

// Deviation thresholds (percentages)
export const DEVIATION_THRESHOLDS = {
  LOW: 0.1,     // 0.1% - Start showing warning
  MEDIUM: 5,   // 5% - Show orange warning
  HIGH: 10,    // 10% - Show red warning + require acknowledgment
} as const;

export type DeviationSeverity = 'none' | 'low' | 'medium' | 'high';

export interface PriceDeviationResult {
  /** Deviation as percentage (e.g., 5.2 means pool is 5.2% different from market) */
  deviationPercent: number | null;
  /** Absolute value of deviation percentage */
  absoluteDeviation: number | null;
  /** Severity level based on thresholds */
  severity: DeviationSeverity;
  /** Whether pool price is higher than market (above) or lower (below) */
  direction: 'above' | 'below' | null;
  /** Loading state */
  isLoading: boolean;
  /** Market price from CoinGecko (token0 in terms of token1) */
  marketPrice: number | null;
  /** Pool price (token0 in terms of token1) */
  poolPrice: number | null;
  /** Human-readable message describing the deviation */
  message: string | null;
}

/**
 * Determine severity level based on deviation percentage
 */
function getSeverity(absoluteDeviation: number | null): DeviationSeverity {
  if (absoluteDeviation === null) return 'none';
  if (absoluteDeviation >= DEVIATION_THRESHOLDS.HIGH) return 'high';
  if (absoluteDeviation >= DEVIATION_THRESHOLDS.MEDIUM) return 'medium';
  if (absoluteDeviation >= DEVIATION_THRESHOLDS.LOW) return 'low';
  return 'none';
}

/**
 * Generate human-readable message for the deviation
 */
function getDeviationMessage(
  absoluteDeviation: number | null,
  direction: 'above' | 'below' | null,
  severity: DeviationSeverity
): string | null {
  if (absoluteDeviation === null || direction === null || severity === 'none') {
    return null;
  }

  const percentStr = absoluteDeviation.toFixed(1);
  const directionWord = direction === 'above' ? 'higher' : 'lower';

  if (severity === 'high') {
    return `Pool price is ${percentStr}% ${directionWord} than market price. This is a significant deviation that may result in unfavorable execution.`;
  }
  if (severity === 'medium') {
    return `Pool price is ${percentStr}% ${directionWord} than market price. Consider checking current market conditions.`;
  }
  return `Pool price is ${percentStr}% ${directionWord} than market price.`;
}

interface UsePriceDeviationParams {
  /** Symbol of token0 (e.g., 'ETH') */
  token0Symbol: string | null | undefined;
  /** Symbol of token1 (e.g., 'USDC') */
  token1Symbol: string | null | undefined;
  /** Pool's current price (token0 in terms of token1) from usePoolState */
  poolPrice: string | number | null | undefined;
  /** Whether the price display is inverted (showing token1/token0 instead of token0/token1) */
  priceInverted?: boolean;
}

/**
 * Hook to compare pool price against CoinGecko market price
 *
 * @example
 * const deviation = usePriceDeviation({
 *   token0Symbol: 'ETH',
 *   token1Symbol: 'USDC',
 *   poolPrice: poolState?.currentPrice,
 * });
 *
 * if (deviation.severity !== 'none') {
 *   // Show warning
 * }
 */
export function usePriceDeviation({
  token0Symbol,
  token1Symbol,
  poolPrice,
  priceInverted = false,
}: UsePriceDeviationParams): PriceDeviationResult {
  // Get CoinGecko prices for both tokens
  const tokenSymbols = useMemo(() => {
    const symbols: string[] = [];
    if (token0Symbol) symbols.push(token0Symbol);
    if (token1Symbol) symbols.push(token1Symbol);
    return symbols;
  }, [token0Symbol, token1Symbol]);

  const { prices, isLoading } = useCoinGeckoPrices(tokenSymbols);

  // Calculate deviation
  const result = useMemo((): PriceDeviationResult => {
    // Default result for loading/invalid states
    const defaultResult: PriceDeviationResult = {
      deviationPercent: null,
      absoluteDeviation: null,
      severity: 'none',
      direction: null,
      isLoading,
      marketPrice: null,
      poolPrice: null,
      message: null,
    };

    // Need both token symbols and pool price
    if (!token0Symbol || !token1Symbol || poolPrice === null || poolPrice === undefined) {
      return defaultResult;
    }

    // Parse pool price
    const poolPriceNum = typeof poolPrice === 'string' ? parseFloat(poolPrice) : poolPrice;
    if (isNaN(poolPriceNum) || poolPriceNum <= 0) {
      return defaultResult;
    }

    // Get CoinGecko prices
    const token0USD = prices[token0Symbol];
    const token1USD = prices[token1Symbol];

    // Calculate market price ratio
    const marketPriceRatio = calculateMarketPriceRatio(token0USD, token1USD);
    if (marketPriceRatio === null) {
      return { ...defaultResult, poolPrice: poolPriceNum };
    }

    // Determine which price to compare based on inversion
    // If inverted, pool shows token1/token0, so we need to invert market price too
    const effectiveMarketPrice = priceInverted ? 1 / marketPriceRatio : marketPriceRatio;

    // Calculate deviation percentage
    // deviation = (poolPrice - marketPrice) / marketPrice * 100
    const deviation = ((poolPriceNum - effectiveMarketPrice) / effectiveMarketPrice) * 100;
    const absoluteDeviation = Math.abs(deviation);
    const direction: 'above' | 'below' = deviation > 0 ? 'above' : 'below';
    const severity = getSeverity(absoluteDeviation);
    const message = getDeviationMessage(absoluteDeviation, direction, severity);

    return {
      deviationPercent: deviation,
      absoluteDeviation,
      severity,
      direction,
      isLoading,
      marketPrice: effectiveMarketPrice,
      poolPrice: poolPriceNum,
      message,
    };
  }, [token0Symbol, token1Symbol, poolPrice, priceInverted, prices, isLoading]);

  return result;
}

/**
 * Check if deviation requires user acknowledgment before proceeding
 */
export function requiresDeviationAcknowledgment(severity: DeviationSeverity): boolean {
  return severity === 'high';
}

/**
 * Check if deviation should show a warning (any severity above 'none')
 */
export function shouldShowDeviationWarning(severity: DeviationSeverity): boolean {
  return severity !== 'none';
}
