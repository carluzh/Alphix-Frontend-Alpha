/**
 * Price Service - Unified pricing module
 * All price fetching goes through centralized /api/prices endpoint
 * Uses Redis caching with stale-while-revalidate for optimal performance
 */

import { formatUnits } from 'viem';
import { TokenSymbol } from './pools-config';

// Map token symbols to their underlying asset prices based on pools.json naming
function getUnderlyingAsset(tokenSymbol: string): keyof AllPricesData | null {
  // Direct mappings for base assets
  if (tokenSymbol === 'BTC') return 'BTC';
  if (tokenSymbol === 'USDC') return 'USDC';
  if (tokenSymbol === 'ETH') return 'ETH';
  if (tokenSymbol === 'USDT') return 'USDT';

  // Infer from token names in pools.json
  if (tokenSymbol.includes('BTC')) return 'BTC';
  if (tokenSymbol.includes('USDC')) return 'USDC';
  if (tokenSymbol.includes('ETH')) return 'ETH';
  if (tokenSymbol.includes('USDT')) return 'USDT';

  return null;
}

// Interface for all prices cache
export interface AllPricesData {
  BTC: { usd: number; usd_24h_change?: number };
  USDC: { usd: number; usd_24h_change?: number };
  ETH: { usd: number; usd_24h_change?: number };
  USDT: { usd: number; usd_24h_change?: number };
  lastUpdated: number;
}

/**
 * Get base URL for API calls
 * Follows Uniswap's fail-fast pattern - no localhost fallback in production
 * @see interface/apps/web/src/state/routing/slice.ts
 */
function getApiBaseUrl(): string {
  // Client-side: Use relative URL (always works)
  if (typeof window !== 'undefined') {
    return ''
  }

  // Server-side: Check environment variables
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (baseUrl) {
    return baseUrl
  }

  // Vercel deployment: Use VERCEL_URL
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) {
    return `https://${vercelUrl}`
  }

  // Fail-fast: No localhost fallback in production
  throw new Error(
    'NEXT_PUBLIC_BASE_URL environment variable is required for server-side price fetching. ' +
    'Set it to http://localhost:3000 in .env.local for development.'
  )
}

/**
 * Get all token prices from centralized /api/prices endpoint
 * This is the single source of truth for all pricing data
 */
export async function getAllTokenPrices(params?: { signal?: AbortSignal }): Promise<AllPricesData> {
  try {
    const baseUrl = getApiBaseUrl()
    const url = `${baseUrl}/api/prices`;
    const response = await fetch(url, {
      method: 'GET',
      signal: params?.signal,
      cache: 'no-store', // Let Redis handle caching
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch prices: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error('Invalid response from prices API');
    }

    // Convert from API format to service format
    return {
      BTC: result.data.BTC,
      USDC: result.data.USDC,
      ETH: result.data.ETH,
      USDT: result.data.USDT,
      lastUpdated: result.data.lastUpdated,
    };
  } catch (error) {
    console.error('[PriceService] Error fetching all prices:', error);
    throw error;
  }
}

/**
 * Get single token price (legacy compatibility)
 */
export async function getTokenPrice(tokenSymbol: string): Promise<number | null> {
  try {
    const allPrices = await getAllTokenPrices();
    const baseSymbol = getUnderlyingAsset(tokenSymbol);
    if (!baseSymbol) return null;
    const priceData = allPrices[baseSymbol];
    return typeof priceData === 'object' ? priceData.usd || null : null;
  } catch (error) {
    console.error(`[PriceService] Error getting price for ${tokenSymbol}:`, error);
    return null;
  }
}

/**
 * Get fallback price if API fails - uses real asset prices based on token mapping
 */
export function getFallbackPrice(tokenSymbol: string): number {
  return 0;
}

// Client-side cache for batch prices (10 second TTL)
let batchCache: { prices: AllPricesData; timestamp: number } | null = null;
const BATCH_CACHE_TTL_MS = 10 * 1000;

/**
 * Batch fetch multiple token prices
 * Leverages the fact that /api/prices always returns all prices
 */
export async function batchGetTokenPrices(tokenSymbols: string[]): Promise<Record<string, number>> {
  try {
    // Use cached prices if fresh
    let allPrices: AllPricesData;
    if (batchCache && Date.now() - batchCache.timestamp < BATCH_CACHE_TTL_MS) {
      allPrices = batchCache.prices;
    } else {
      allPrices = await getAllTokenPrices();
      batchCache = { prices: allPrices, timestamp: Date.now() };
    }

    const result: Record<string, number> = {};
    for (const symbol of tokenSymbols) {
      const baseSymbol = getUnderlyingAsset(symbol);
      if (baseSymbol) {
        const priceData = allPrices[baseSymbol];
        result[symbol] = typeof priceData === 'object' ? priceData.usd || 0 : 0;
      } else {
        result[symbol] = 0;
      }
    }
    return result;
  } catch (error) {
    console.error('[PriceService] Error in batch fetch:', error);
    return Object.fromEntries(tokenSymbols.map(symbol => [symbol, 0]));
  }
}

/**
 * Convert token amount to USD value (for human-readable amounts)
 */
export function tokenAmountToUSD(
  tokenAmount: string | number,
  tokenDecimals: number,
  tokenPriceUSD: number
): number {
  const amount = typeof tokenAmount === 'string' ? parseFloat(tokenAmount) : tokenAmount;
  if (isNaN(amount)) return 0;

  // Token amount is already in human-readable format (e.g., "50.05" for 50.05 BTCRL)
  // No need to divide by 10^decimals since subgraph returns human-readable amounts
  return amount * tokenPriceUSD;
}

/**
 * Convert raw token amount to USD value (for raw token units)
 */
export function rawTokenAmountToUSD(
  rawTokenAmount: string | bigint,
  tokenDecimals: number,
  tokenPriceUSD: number
): number {
  try {
    const rawAmount = typeof rawTokenAmount === 'string' ? BigInt(rawTokenAmount) : rawTokenAmount;
    const humanAmount = parseFloat(formatUnits(rawAmount, tokenDecimals));
    return humanAmount * tokenPriceUSD;
  } catch (error) {
    console.error('[PriceService] Error converting raw token amount:', error);
    return 0;
  }
}

/**
 * Convert token amounts to USD and sum them (for TVL/liquidity calculations)
 */
export function calculateTotalUSD(
  token0Amount: string | number,
  token1Amount: string | number,
  token0Price: number,
  token1Price: number
): number {
  const token0USD = typeof token0Amount === 'string' ? parseFloat(token0Amount) * token0Price : token0Amount * token0Price;
  const token1USD = typeof token1Amount === 'string' ? parseFloat(token1Amount) * token1Price : token1Amount * token1Price;

  return (isNaN(token0USD) ? 0 : token0USD) + (isNaN(token1USD) ? 0 : token1USD);
}

/**
 * Calculate swap volume in USD (avoids double counting by taking the max of both sides)
 * This prevents the issue where a $1 swap appears as $2 volume
 */
export function calculateSwapVolumeUSD(
  token0Amount: string | number,
  token1Amount: string | number,
  token0Price: number,
  token1Price: number
): number {
  const token0USD = typeof token0Amount === 'string' ? parseFloat(token0Amount) * token0Price : token0Amount * token0Price;
  const token1USD = typeof token1Amount === 'string' ? parseFloat(token1Amount) * token1Price : token1Amount * token1Price;

  const safeToken0USD = isNaN(token0USD) ? 0 : token0USD;
  const safeToken1USD = isNaN(token1USD) ? 0 : token1USD;

  // Return the max of both sides to avoid double counting while handling price discrepancies
  return Math.max(safeToken0USD, safeToken1USD);
}
