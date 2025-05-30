import { getFromCache, setToCache } from './client-cache';

// Cache keys
const PRICE_CACHE_KEY_PREFIX = 'token_price_';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko API endpoints
const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_PRICE_ENDPOINT = `${COINGECKO_API_URL}/simple/price`;

// Token IDs mapping (CoinGecko IDs)
const TOKEN_COINGECKO_IDS = {
  'BTC': 'bitcoin',
  'USDC': 'usd-coin'
};

// Interface for price data
export interface TokenPriceData {
  usd: number;
  lastUpdated: number;
}

/**
 * Get the cache key for a specific token
 */
function getPriceCacheKey(tokenSymbol: string): string {
  return `${PRICE_CACHE_KEY_PREFIX}${tokenSymbol.toLowerCase()}`;
}

/**
 * Check if the cached price data is still valid
 */
function isCacheValid(data: TokenPriceData | null): boolean {
  if (!data) return false;
  return Date.now() - data.lastUpdated < CACHE_DURATION_MS;
}

/**
 * Fetch token price from CoinGecko
 * @param tokenSymbol The token symbol (BTC, USDC)
 * @returns Price data or null if fetch failed
 */
async function fetchTokenPrice(tokenSymbol: string): Promise<TokenPriceData | null> {
  try {
    const coingeckoId = TOKEN_COINGECKO_IDS[tokenSymbol as keyof typeof TOKEN_COINGECKO_IDS];
    if (!coingeckoId) {
      console.error(`No CoinGecko ID mapping for token: ${tokenSymbol}`);
      return null;
    }

    console.log(`[PriceService] Fetching price for ${tokenSymbol} (${coingeckoId}) from CoinGecko`);
    
    const response = await fetch(
      `${COINGECKO_PRICE_ENDPOINT}?ids=${coingeckoId}&vs_currencies=usd`, 
      { cache: 'no-store' }
    );
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data[coingeckoId]?.usd) {
      throw new Error(`No price data returned for ${tokenSymbol}`);
    }
    
    const priceData: TokenPriceData = {
      usd: data[coingeckoId].usd,
      lastUpdated: Date.now()
    };
    
    console.log(`[PriceService] Got price for ${tokenSymbol}: $${priceData.usd}`);
    return priceData;
  } catch (error) {
    console.error(`[PriceService] Error fetching price for ${tokenSymbol}:`, error);
    return null;
  }
}

/**
 * Get token price with caching
 * @param tokenSymbol The token symbol (BTC, USDC)
 * @returns The token price in USD or null if unavailable
 */
export async function getTokenPrice(tokenSymbol: string): Promise<number | null> {
  const cacheKey = getPriceCacheKey(tokenSymbol);
  const cachedData = getFromCache<TokenPriceData>(cacheKey);
  
  // Use cache if valid
  if (isCacheValid(cachedData)) {
    console.log(`[PriceService] Using cached price for ${tokenSymbol}: $${cachedData.usd}`);
    return cachedData.usd;
  }
  
  // Fetch fresh price
  const priceData = await fetchTokenPrice(tokenSymbol);
  
  // Cache if successful
  if (priceData) {
    setToCache(cacheKey, priceData);
    return priceData.usd;
  }
  
  // If cache invalid and fetch failed, use old cache as fallback
  if (cachedData) {
    console.log(`[PriceService] Using expired cache for ${tokenSymbol} as fallback: $${cachedData.usd}`);
    return cachedData.usd;
  }
  
  return null;
}

/**
 * Get fallback price if API fails
 * @param tokenSymbol The token symbol
 * @returns Fallback price
 */
export function getFallbackPrice(tokenSymbol: string): number {
  // Hardcoded fallback prices
  const fallbacks: Record<string, number> = {
    'BTC': 77000,
    'USDC': 1
  };
  
  return fallbacks[tokenSymbol] || 0;
} 