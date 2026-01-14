/**
 * Aave Rates Client
 *
 * Client for fetching Aave lending rates from the AlphixBackend.
 * Used for Unified Yield APR display in position/pool pages.
 */

// Backend URL - defaults to localhost for development
const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

/**
 * Token symbol to Aave key mapping
 * POC: USDT is mapped to GHO
 */
const TOKEN_TO_AAVE_KEY: Record<string, string> = {
  'USDC': 'USDC',
  'WETH': 'WETH',
  'ETH': 'WETH',
  'USDT': 'GHO',  // POC: Treat USDT as GHO
  'GHO': 'GHO',
};

/**
 * Single token rate data
 */
export interface AaveTokenRate {
  apy: number;
  utilization: number;
  timestamp: number;
}

/**
 * Current rates response
 */
export interface AaveRatesResponse {
  success: boolean;
  source?: 'cached' | 'live';
  data: Record<string, AaveTokenRate>;
  error?: string;
}

/**
 * Historical rate point
 */
export interface AaveHistoryPoint {
  timestamp: number;
  apy: number;
  utilization: number;
}

/**
 * Historical rates response
 */
export interface AaveHistoryResponse {
  success: boolean;
  token: string;
  period: 'DAY' | 'WEEK' | 'MONTH';
  fromTimestamp: number;
  toTimestamp: number;
  points: AaveHistoryPoint[];
  error?: string;
}

/**
 * Get the Aave key for a token symbol
 */
export function getAaveKey(tokenSymbol: string): string | null {
  const upperSymbol = tokenSymbol.toUpperCase();
  return TOKEN_TO_AAVE_KEY[upperSymbol] || null;
}

/**
 * Check if a token is supported by Aave
 */
export function isAaveSupported(tokenSymbol: string): boolean {
  return getAaveKey(tokenSymbol) !== null;
}

// In-memory cache for current rates (5 minute TTL)
let ratesCache: { data: AaveRatesResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch current Aave rates for all supported tokens
 * Uses in-memory cache to avoid excessive API calls
 */
export async function fetchAaveRates(): Promise<AaveRatesResponse> {
  // Check cache first
  if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_TTL_MS) {
    return ratesCache.data;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/aave/rates`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data: AaveRatesResponse = await response.json();

    // Update cache
    ratesCache = { data, timestamp: Date.now() };

    return data;
  } catch (error) {
    // Return cached data if available, even if stale
    if (ratesCache) {
      console.warn('[fetchAaveRates] API failed, using stale cache:', error);
      return ratesCache.data;
    }

    return {
      success: false,
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get current Aave APY for a specific token
 * Returns null if token not supported or fetch fails
 */
export async function getAaveApy(tokenSymbol: string): Promise<number | null> {
  const aaveKey = getAaveKey(tokenSymbol);
  if (!aaveKey) return null;

  const rates = await fetchAaveRates();
  if (!rates.success || !rates.data[aaveKey]) return null;

  return rates.data[aaveKey].apy;
}

/**
 * Get current Aave APY for a position's tokens
 * Returns the average APY if both tokens are supported, otherwise the single supported token's APY
 */
export async function getPositionAaveApy(
  token0Symbol: string,
  token1Symbol: string
): Promise<number | null> {
  const rates = await fetchAaveRates();
  if (!rates.success) return null;

  const key0 = getAaveKey(token0Symbol);
  const key1 = getAaveKey(token1Symbol);

  const apy0 = key0 && rates.data[key0] ? rates.data[key0].apy : null;
  const apy1 = key1 && rates.data[key1] ? rates.data[key1].apy : null;

  if (apy0 !== null && apy1 !== null) {
    // Both tokens supported - return average
    return (apy0 + apy1) / 2;
  } else if (apy0 !== null) {
    return apy0;
  } else if (apy1 !== null) {
    return apy1;
  }

  return null;
}

/**
 * Fetch historical Aave rates for a token
 */
export async function fetchAaveHistory(
  tokenSymbol: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W'
): Promise<AaveHistoryResponse> {
  const aaveKey = getAaveKey(tokenSymbol);
  if (!aaveKey) {
    return {
      success: false,
      token: tokenSymbol,
      period: 'WEEK',
      fromTimestamp: 0,
      toTimestamp: 0,
      points: [],
      error: `Token ${tokenSymbol} not supported by Aave`,
    };
  }

  // Map frontend period format to backend format
  const periodMap: Record<string, 'DAY' | 'WEEK' | 'MONTH'> = {
    '1W': 'WEEK',
    '1M': 'MONTH',
    '1Y': 'MONTH',
    'ALL': 'MONTH',
  };
  const backendPeriod = periodMap[period] || 'WEEK';

  try {
    const response = await fetch(
      `${BACKEND_URL}/aave/rates/history?token=${encodeURIComponent(aaveKey)}&period=${backendPeriod}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      token: aaveKey,
      period: backendPeriod,
      fromTimestamp: 0,
      toTimestamp: 0,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch historical rates for both tokens in a position
 * Returns merged data with timestamps aligned
 */
export async function fetchPositionAaveHistory(
  token0Symbol: string,
  token1Symbol: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W'
): Promise<{
  success: boolean;
  points: Array<{ timestamp: number; apy: number }>;
  error?: string;
}> {
  const key0 = getAaveKey(token0Symbol);
  const key1 = getAaveKey(token1Symbol);

  // Fetch both in parallel
  const [history0, history1] = await Promise.all([
    key0 ? fetchAaveHistory(token0Symbol, period) : Promise.resolve(null),
    key1 ? fetchAaveHistory(token1Symbol, period) : Promise.resolve(null),
  ]);

  // If neither token is supported, return empty
  if (!history0?.success && !history1?.success) {
    return {
      success: false,
      points: [],
      error: 'No supported tokens for Aave rates',
    };
  }

  // If only one token supported, use its rates
  if (!history0?.success && history1?.success) {
    return {
      success: true,
      points: history1.points.map(p => ({ timestamp: p.timestamp, apy: p.apy })),
    };
  }
  if (history0?.success && !history1?.success) {
    return {
      success: true,
      points: history0.points.map(p => ({ timestamp: p.timestamp, apy: p.apy })),
    };
  }

  // Both tokens supported - merge by averaging at each timestamp
  const timestampMap = new Map<number, { apy0?: number; apy1?: number }>();

  for (const p of history0!.points) {
    timestampMap.set(p.timestamp, { apy0: p.apy });
  }
  for (const p of history1!.points) {
    const existing = timestampMap.get(p.timestamp) || {};
    timestampMap.set(p.timestamp, { ...existing, apy1: p.apy });
  }

  const mergedPoints = Array.from(timestampMap.entries())
    .map(([timestamp, { apy0, apy1 }]) => {
      // Average if both available, otherwise use whichever is available
      let apy: number;
      if (apy0 !== undefined && apy1 !== undefined) {
        apy = (apy0 + apy1) / 2;
      } else {
        apy = apy0 ?? apy1 ?? 0;
      }
      return { timestamp, apy };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    success: true,
    points: mergedPoints,
  };
}

/**
 * Hook-friendly wrapper that includes loading/error state
 * For use with React Query or SWR
 */
export const aaveRatesQueryKey = ['aave', 'rates'] as const;
export const aaveHistoryQueryKey = (token: string, period: string) =>
  ['aave', 'history', token, period] as const;
