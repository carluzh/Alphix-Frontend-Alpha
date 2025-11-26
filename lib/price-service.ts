import { getFromCache, setToCache } from './client-cache';

// Cache keys
const PRICE_CACHE_KEY_PREFIX = 'token_price_';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko API endpoints
const COINGECKO_PRICE_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

// Token IDs mapping (CoinGecko IDs)
const TOKEN_COINGECKO_IDS = {
  'BTC': 'bitcoin',
  'USDC': 'usd-coin',
  'ETH': 'ethereum'
};

// Interface for price data
export interface TokenPriceData {
  usd: number;
  lastUpdated: number;
}

/**
 * Fetch token price from CoinGecko
 */
async function fetchTokenPrice(tokenSymbol: string): Promise<TokenPriceData | null> {
  try {
    const coingeckoId = TOKEN_COINGECKO_IDS[tokenSymbol as keyof typeof TOKEN_COINGECKO_IDS];
    if (!coingeckoId) return null;

    const response = await fetch(
      `${COINGECKO_PRICE_ENDPOINT}?ids=${coingeckoId}&vs_currencies=usd`, 
      { cache: 'no-store' }
    );
    
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
    
    const data = await response.json();
    if (!data[coingeckoId]?.usd) throw new Error(`No price data for ${tokenSymbol}`);
    
    return {
      usd: data[coingeckoId].usd,
      lastUpdated: Date.now()
    };
  } catch (error) {
    console.error(`[PriceService] Error fetching ${tokenSymbol}:`, error);
    return null;
  }
}

/**
 * Get token price with caching
 */
export async function getTokenPrice(tokenSymbol: string): Promise<number | null> {
  const cacheKey = `${PRICE_CACHE_KEY_PREFIX}${tokenSymbol.toLowerCase()}`;
  const cachedData = getFromCache<TokenPriceData>(cacheKey);
  
  // Use cache if valid
  if (cachedData && Date.now() - cachedData.lastUpdated < CACHE_DURATION_MS) {
    return cachedData.usd;
  }
  
  // Fetch fresh price
  const priceData = await fetchTokenPrice(tokenSymbol);
  
  // Cache if successful
  if (priceData) {
    setToCache(cacheKey, priceData);
    return priceData.usd;
  }
  
  // Use old cache as fallback
  if (cachedData) return cachedData.usd;
  
  return null;
}

/**
 * Get fallback price if API fails
 */
export function getFallbackPrice(tokenSymbol: string): number {
  const fallbacks: Record<string, number> = {
    'BTC': 77000,
    'USDC': 1,
    'ETH': 3500
  };
  
  return fallbacks[tokenSymbol] || 0;
} 