import { getFromCache, setToCache, getOngoingRequest, setOngoingRequest } from './client-cache';
import { formatUnits } from 'viem';

// Global cache key for all prices
const ALL_PRICES_CACHE_KEY = 'all_token_prices';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko API endpoints
const COINGECKO_PRICE_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';
const API_TIMEOUT_MS = 8000;

// All coins we need in one batch - only 5 real coins
const ALL_COINGECKO_IDS = ['bitcoin', 'usd-coin', 'ethereum', 'tether', 'dai'];
const ONGOING_REQUEST_KEY = 'fetch_all_prices';


// Map token symbols to their underlying asset prices based on pools.json naming
function getUnderlyingAsset(tokenSymbol: string): keyof AllPricesData | null {
  // Direct mappings for base assets
  if (tokenSymbol === 'BTC') return 'BTC';
  if (tokenSymbol === 'USDC') return 'USDC';
  if (tokenSymbol === 'ETH') return 'ETH';
  if (tokenSymbol === 'USDT') return 'USDT';
  if (tokenSymbol === 'DAI') return 'DAI';
  
  // Infer from token names in pools.json
  if (tokenSymbol.includes('BTC')) return 'BTC';
  if (tokenSymbol.includes('USDC')) return 'USDC';
  if (tokenSymbol.includes('ETH')) return 'ETH';
  if (tokenSymbol.includes('USDT')) return 'USDT';
  if (tokenSymbol.includes('DAI')) return 'DAI';
  
  return null;
}

// Interface for all prices cache
export interface AllPricesData {
  BTC: { usd: number; usd_24h_change?: number };
  USDC: { usd: number; usd_24h_change?: number };
  ETH: { usd: number; usd_24h_change?: number };
  USDT: { usd: number; usd_24h_change?: number };
  DAI: { usd: number; usd_24h_change?: number };
  lastUpdated: number;
}

/**
 * Fetch ALL prices in one API call and cache globally
 */
async function fetchAllPrices(signal?: AbortSignal): Promise<AllPricesData> {
  // Check if there's an ongoing request
  const ongoingRequest = getOngoingRequest<AllPricesData>(ONGOING_REQUEST_KEY);
  if (ongoingRequest) {
    console.log('[PriceService] Using ongoing request for all prices');
    return ongoingRequest;
  }

  const promise = (async (): Promise<AllPricesData> => {
    console.log('[PriceService] Fetching all prices from CoinGecko...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    
    try {
      // Use proxied endpoint when running in browser (avoid CORS and rate limits)
      const isBrowser = typeof window !== 'undefined';
      const url = isBrowser
        ? `/api/prices?ids=${ALL_COINGECKO_IDS.join(',')}&vs=usd&include_24hr_change=true`
        : `${COINGECKO_PRICE_ENDPOINT}?ids=${ALL_COINGECKO_IDS.join(',')}&vs_currencies=usd&include_24hr_change=true`;

      const response = await fetch(url, { 
        cache: 'no-store',
        signal: signal || controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[PriceService] CoinGecko response:', data);
      
      const prices: AllPricesData = {
        BTC: { usd: data.bitcoin?.usd || 0, usd_24h_change: data.bitcoin?.usd_24h_change },
        USDC: { usd: data['usd-coin']?.usd || 1, usd_24h_change: data['usd-coin']?.usd_24h_change },
        ETH: { usd: data.ethereum?.usd || 0, usd_24h_change: data.ethereum?.usd_24h_change },
        USDT: { usd: data.tether?.usd || 1, usd_24h_change: data.tether?.usd_24h_change },
        DAI: { usd: data.dai?.usd || 1, usd_24h_change: data.dai?.usd_24h_change },
        lastUpdated: Date.now()
      };
      
      console.log('[PriceService] Parsed prices:', prices);
      
      // Cache the result
      setToCache(ALL_PRICES_CACHE_KEY, prices);
      
      return prices;
      
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[PriceService] Error fetching all prices:', error);
      
      // Return fallback prices on error
      throw error;
    }
  })();

  return setOngoingRequest(ONGOING_REQUEST_KEY, promise);
}

/**
 * Get all token prices - main entry point
 */
export async function getAllTokenPrices(params?: { signal?: AbortSignal }): Promise<AllPricesData> {
  // Check cache first
  const cachedData = getFromCache<AllPricesData>(ALL_PRICES_CACHE_KEY);
  
  if (cachedData && Date.now() - cachedData.lastUpdated < CACHE_DURATION_MS) {
    console.log('[PriceService] Using cached prices');
    return cachedData;
  }
  
  // Fetch fresh prices
  return await fetchAllPrices(params?.signal);
}

/**
 * Get single token price (legacy compatibility)
 */
export async function getTokenPrice(tokenSymbol: string): Promise<number | null> {
  const allPrices = await getAllTokenPrices();
  const baseSymbol = getUnderlyingAsset(tokenSymbol);
  return baseSymbol ? allPrices[baseSymbol]?.usd || null : null;
}

/**
 * Get fallback price if API fails - uses real asset prices based on token mapping
 */
export function getFallbackPrice(tokenSymbol: string): number {
  return 0;
}

/**
 * Batch fetch multiple token prices - simplified to use global cache
 */
export async function batchGetTokenPrices(tokenSymbols: string[]): Promise<Record<string, number>> {
  console.log(`[PriceService] Batch request for: ${tokenSymbols.join(', ')}`);
  
  // Get all prices in one call
  const allPrices = await getAllTokenPrices();
  
  // Map the requested symbols to their prices
  const result: Record<string, number> = {};
  
  for (const symbol of tokenSymbols) {
    const price = await getTokenPrice(symbol);
    if (price !== null) {
      result[symbol] = price;
    } else {
      // Use fallback for unknown symbols
      result[symbol] = 0;
    }
  }
  
  console.log('[PriceService] Batch result:', result);
  return result;
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