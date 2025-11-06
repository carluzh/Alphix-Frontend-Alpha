/**
 * Auto-slippage API client
 * Based on CowSwap's BFF API approach
 */

import { MIN_AUTO_SLIPPAGE_TOLERANCE, MAX_AUTO_SLIPPAGE_TOLERANCE, DEFAULT_SWAP_SLIPPAGE } from './slippage-constants';

// API configuration
const SLIPPAGE_API_TIMEOUT = 2000; // 2 seconds like CowSwap
const SLIPPAGE_API_BASE_URL = process.env.NEXT_PUBLIC_SLIPPAGE_API_URL || '';

interface SlippageToleranceRequest {
  sellToken: string;
  buyToken: string;
  chainId: number;
}

interface SlippageToleranceResponse {
  slippageBps: number | null;
}

/**
 * Fetch auto-slippage from backend API
 * Returns slippage in percentage (e.g., 0.5 for 0.5%)
 */
export async function fetchAutoSlippage(params: SlippageToleranceRequest): Promise<number | null> {
  // If no API URL configured, return null to use fallback calculation
  if (!SLIPPAGE_API_BASE_URL) {
    console.log('[fetchAutoSlippage] No API URL configured, using fallback');
    return null;
  }

  const { sellToken, buyToken, chainId } = params;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SLIPPAGE_API_TIMEOUT);

  try {
    const url = `${SLIPPAGE_API_BASE_URL}/${chainId}/markets/${sellToken}-${buyToken}/slippageTolerance`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('[fetchAutoSlippage] API error:', response.status);
      return null;
    }

    const data: SlippageToleranceResponse = await response.json();

    if (typeof data.slippageBps !== 'number' || data.slippageBps === null) {
      console.log('[fetchAutoSlippage] No slippage data returned');
      return null;
    }

    // Convert from basis points to percentage
    const slippagePercent = data.slippageBps / 100;

    // Validate against bounds
    if (slippagePercent < MIN_AUTO_SLIPPAGE_TOLERANCE) {
      console.warn('[fetchAutoSlippage] Returned slippage too low:', slippagePercent);
      return null;
    }

    if (slippagePercent > MAX_AUTO_SLIPPAGE_TOLERANCE) {
      console.warn('[fetchAutoSlippage] Returned slippage too high:', slippagePercent);
      return null;
    }

    console.log('[fetchAutoSlippage] Got auto-slippage:', slippagePercent + '%');
    return slippagePercent;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[fetchAutoSlippage] Request timed out after', SLIPPAGE_API_TIMEOUT, 'ms');
    } else {
      console.error('[fetchAutoSlippage] Request failed:', error);
    }

    return null;
  }
}

/**
 * Fallback calculation when API is unavailable
 * Simplified version based on trade characteristics
 */
export function calculateFallbackSlippage(params: {
  fromAmount: string;
  toAmount: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  routeHops?: number;
  isStablePair?: boolean;
}): number {
  const {
    fromAmount,
    toAmount,
    routeHops = 1,
    isStablePair = false,
  } = params;

  // If no amounts, return default
  if (!fromAmount || !toAmount || parseFloat(fromAmount) === 0) {
    return DEFAULT_SWAP_SLIPPAGE;
  }

  let baseSlippage = DEFAULT_SWAP_SLIPPAGE; // 0.5%

  // Adjust for route complexity
  if (routeHops > 1) {
    // Multi-hop routes need higher slippage
    baseSlippage += (routeHops - 1) * 0.15; // +0.15% per additional hop
  }

  // Adjust for stable pairs (lower slippage needed)
  if (isStablePair) {
    baseSlippage *= 0.5; // Halve the slippage for stable pairs
  }

  // Calculate trade size impact
  const amount = parseFloat(fromAmount);
  if (amount > 1000) {
    // Large trades need more slippage
    baseSlippage += Math.min(1, Math.log10(amount / 1000) * 0.3);
  }

  // Cap between min and max
  const finalSlippage = Math.max(
    MIN_AUTO_SLIPPAGE_TOLERANCE,
    Math.min(MAX_AUTO_SLIPPAGE_TOLERANCE, baseSlippage)
  );

  return parseFloat(finalSlippage.toFixed(2));
}

/**
 * Check if token pair is likely a stablecoin pair
 */
export function isStablecoinPair(token0: string, token1: string): boolean {
  const stablecoins = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'USDbC'];

  const token0Upper = token0.toUpperCase();
  const token1Upper = token1.toUpperCase();

  return stablecoins.includes(token0Upper) && stablecoins.includes(token1Upper);
}

/**
 * Get auto-slippage with API fallback
 * Tries API first, falls back to calculation if API fails
 */
export async function getAutoSlippage(params: {
  sellToken: string;
  buyToken: string;
  chainId: number;
  fromAmount: string;
  toAmount: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  routeHops?: number;
}): Promise<number> {
  const {
    sellToken,
    buyToken,
    chainId,
    fromAmount,
    toAmount,
    fromTokenSymbol,
    toTokenSymbol,
    routeHops,
  } = params;

  // Try API first
  const apiSlippage = await fetchAutoSlippage({ sellToken, buyToken, chainId });

  if (apiSlippage !== null) {
    return apiSlippage;
  }

  // Fallback to calculation
  console.log('[getAutoSlippage] Using fallback calculation');
  return calculateFallbackSlippage({
    fromAmount,
    toAmount,
    fromTokenSymbol,
    toTokenSymbol,
    routeHops,
    isStablePair: isStablecoinPair(fromTokenSymbol, toTokenSymbol),
  });
}
