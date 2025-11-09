import { getFromCache, setToCache, getOngoingRequest, setOngoingRequest } from './client-cache';
import { formatUnits } from 'viem';
import { TokenSymbol } from './pools-config';

// Global cache key for all prices
const ALL_PRICES_CACHE_KEY = 'all_token_prices';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const API_TIMEOUT_MS = 8000;
const ONGOING_REQUEST_KEY = 'fetch_all_prices';
const QUOTE_AMOUNT_USDC = 100; // Quote 100 aUSDC against token (like Uniswap uses 1000)
const TARGET_CHAIN_ID = 84532; // Base Sepolia


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
 * Get USD price for a token by quoting against aUSDC
 * Server-side version of useTokenUSDPrice hook
 */
async function getTokenUSDPriceViaQuote(tokenSymbol: TokenSymbol): Promise<number | null> {
  // aUSDC is always $1
  if (tokenSymbol === 'aUSDC') {
    return 1;
  }

  try {
    const isBrowser = typeof window !== 'undefined';
    // For server-side, use absolute URL if available, otherwise use relative (works in Next.js API routes)
    const baseUrl = isBrowser 
      ? '' 
      : (process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : 'http://localhost:3000');
    
    const url = `${baseUrl}/api/swap/get-quote`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: 'aUSDC',
        toTokenSymbol: tokenSymbol,
        amountDecimalsStr: QUOTE_AMOUNT_USDC.toString(),
        swapType: 'ExactIn',
        chainId: TARGET_CHAIN_ID,
        debug: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch price quote: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.toAmount) {
      const tokenAmount = parseFloat(data.toAmount);
      if (tokenAmount > 0) {
        return QUOTE_AMOUNT_USDC / tokenAmount;
      }
    }
    return null;
  } catch (error) {
    console.error(`[PriceService] Error fetching price for ${tokenSymbol}:`, error);
    return null;
  }
}

/**
 * Fetch ALL prices in one API call and cache globally
 * Uses quote API instead of CoinGecko
 */
async function fetchAllPrices(signal?: AbortSignal): Promise<AllPricesData> {
  // Check if there's an ongoing request
  const ongoingRequest = getOngoingRequest<AllPricesData>(ONGOING_REQUEST_KEY);
  if (ongoingRequest) {
    console.log('[PriceService] Using ongoing request for all prices');
    return ongoingRequest;
  }

  const promise = (async (): Promise<AllPricesData> => {
    console.log('[PriceService] Fetching all prices via quote API...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    
    try {
      // Fetch prices for all tokens in parallel
      const [btcPrice, ethPrice, usdtPrice, daiPrice] = await Promise.all([
        getTokenUSDPriceViaQuote('aBTC'),
        getTokenUSDPriceViaQuote('aETH'),
        getTokenUSDPriceViaQuote('aUSDT'),
        getTokenUSDPriceViaQuote('aDAI'),
      ]);
      
      clearTimeout(timeoutId);
      
      const prices: AllPricesData = {
        BTC: { usd: btcPrice || 0 },
        USDC: { usd: 1 }, // aUSDC is always $1
        ETH: { usd: ethPrice || 0 },
        USDT: { usd: usdtPrice || 1 },
        DAI: { usd: daiPrice || 1 },
        lastUpdated: Date.now()
      };
      
      console.log('[PriceService] Parsed prices:', prices);
      
      // Cache the result
      setToCache(ALL_PRICES_CACHE_KEY, prices);
      
      return prices;
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      console.error('[PriceService] Error fetching all prices:', error);
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
  if (!baseSymbol) return null;
  const priceData = allPrices[baseSymbol];
  return typeof priceData === 'object' ? priceData.usd || null : null;
}

/**
 * Get fallback price if API fails - uses real asset prices based on token mapping
 */
export function getFallbackPrice(tokenSymbol: string): number {
  return 0;
}

/**
 * Batch fetch multiple token prices - uses quote API
 */
export async function batchGetTokenPrices(tokenSymbols: string[]): Promise<Record<string, number>> {
  console.log(`[PriceService] Batch request for: ${tokenSymbols.join(', ')}`);
  
  // Fetch prices for all tokens in parallel using quote API
  const pricePromises = tokenSymbols.map(async (symbol) => {
    const baseSymbol = getUnderlyingAsset(symbol);
    if (!baseSymbol) {
      return { symbol, price: 0 };
    }
    
    // Map base symbol to token symbol for quote
    let quoteSymbol: TokenSymbol;
    switch (baseSymbol) {
      case 'BTC':
        quoteSymbol = 'aBTC';
        break;
      case 'ETH':
        quoteSymbol = 'aETH';
        break;
      case 'USDT':
        quoteSymbol = 'aUSDT';
        break;
      case 'DAI':
        quoteSymbol = 'aDAI';
        break;
      case 'USDC':
        return { symbol, price: 1 }; // USDC is always $1
      default:
        return { symbol, price: 0 };
    }
    
    const price = await getTokenUSDPriceViaQuote(quoteSymbol);
    return { symbol, price: price || 0 };
  });
  
  const results = await Promise.all(pricePromises);
  const result: Record<string, number> = {};
  
  for (const { symbol, price } of results) {
    result[symbol] = price;
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