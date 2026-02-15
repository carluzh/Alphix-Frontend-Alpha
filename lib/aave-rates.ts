/**
 * Unified Yield Rates Client
 * Fetches lending rates from Aave/Spark via AlphixBackend.
 * Pool-level yield factors configured in POOL_YIELD_FACTORS.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

// ============================================================================
// POOL YIELD FACTORS - Single source of truth for per-pool yield discounts
// ============================================================================

/** Pool yield factors: key = sorted symbols joined by '/', value = multiplier (0.70 = 30% fee) */
const POOL_YIELD_FACTORS: Record<string, number> = {
  'USDC/USDS': 0.70,
  'ATDAI/ATUSDC': 0.70,
};

function makePoolKey(token0: string, token1: string): string {
  return [token0.toUpperCase(), token1.toUpperCase()].sort().join('/');
}

export function getPoolYieldFactor(token0Symbol: string, token1Symbol: string): number {
  return POOL_YIELD_FACTORS[makePoolKey(token0Symbol, token1Symbol)] ?? 1.0;
}

export function applyPoolYieldFactor(rawYield: number, token0Symbol: string, token1Symbol: string): number {
  return rawYield * getPoolYieldFactor(token0Symbol, token1Symbol);
}

export function applyPoolYieldFactorToHistory<T extends { apy: number }>(
  points: T[],
  token0Symbol: string,
  token1Symbol: string
): T[] {
  const factor = getPoolYieldFactor(token0Symbol, token1Symbol);
  return factor === 1.0 ? points : points.map(p => ({ ...p, apy: p.apy * factor }));
}

// ============================================================================

type ProtocolSource = 'aave' | 'spark';

interface TokenMapping {
  key: string;        // Backend key (e.g., 'USDC', 'DAI')
  protocol: ProtocolSource;
}

/**
 * Token symbol to protocol/key mapping
 * Maps frontend token symbols to their lending protocol and backend key.
 *
 * Aave: USDC, WETH, GHO (via /aave/rates)
 * Spark: DAI, USDS (via /spark/rates)
 */
const TOKEN_TO_PROTOCOL: Record<string, TokenMapping> = {
  // Aave tokens
  'USDC': { key: 'USDC', protocol: 'aave' },
  'WETH': { key: 'WETH', protocol: 'aave' },
  'ETH': { key: 'WETH', protocol: 'aave' },
  'GHO': { key: 'GHO', protocol: 'aave' },
  // Spark tokens
  'DAI': { key: 'DAI', protocol: 'spark' },
  'USDS': { key: 'USDS', protocol: 'spark' },
  // Testnet tokens (Base Sepolia) - simulates mainnet USDS/USDC pool
  'ATDAI': { key: 'USDS', protocol: 'spark' },  // atDAI represents USDS (Spark)
  'ATUSDC': { key: 'USDC', protocol: 'aave' },  // atUSDC represents USDC (Aave)
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
 * Get the protocol mapping for a token symbol
 */
export function getTokenProtocol(tokenSymbol: string): TokenMapping | null {
  const upperSymbol = tokenSymbol.toUpperCase();
  return TOKEN_TO_PROTOCOL[upperSymbol] || null;
}

function getAaveKey(tokenSymbol: string): string | null {
  return getTokenProtocol(tokenSymbol)?.key || null;
}

/**
 * Check if a token is supported by Aave or Spark
 */
export function isAaveSupported(tokenSymbol: string): boolean {
  return getTokenProtocol(tokenSymbol) !== null;
}

/**
 * Get yield sources for a token pair
 * Derives which lending protocols (aave, spark) are used based on the tokens.
 * Returns unique protocols in consistent order: aave first, then spark.
 */
export function getYieldSourcesForTokens(
  token0Symbol?: string,
  token1Symbol?: string
): Array<'aave' | 'spark'> {
  const sources = new Set<'aave' | 'spark'>();

  if (token0Symbol) {
    const mapping = getTokenProtocol(token0Symbol);
    if (mapping) sources.add(mapping.protocol);
  }

  if (token1Symbol) {
    const mapping = getTokenProtocol(token1Symbol);
    if (mapping) sources.add(mapping.protocol);
  }

  // Return in consistent order: aave first, then spark
  const result: Array<'aave' | 'spark'> = [];
  if (sources.has('aave')) result.push('aave');
  if (sources.has('spark')) result.push('spark');

  return result.length > 0 ? result : ['aave']; // Default to aave if no tokens matched
}

// In-memory cache for current rates (5 minute TTL)
let ratesCache: { data: AaveRatesResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch current rates from both Aave and Spark protocols
 * Combines rates into a unified response
 * Uses in-memory cache to avoid excessive API calls
 */
export async function fetchAaveRates(): Promise<AaveRatesResponse> {
  // Check cache first
  if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_TTL_MS) {
    return ratesCache.data;
  }

  try {
    // Fetch from both protocols in parallel
    const [aaveResponse, sparkResponse] = await Promise.all([
      fetch(`${BACKEND_URL}/aave/rates`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null),
      fetch(`${BACKEND_URL}/spark/rates`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null),
    ]);

    const combinedData: Record<string, AaveTokenRate> = {};

    // Process Aave response - store RAW rates (no discount applied)
    if (aaveResponse?.ok) {
      const aaveData = await aaveResponse.json();
      if (aaveData.success && aaveData.data) {
        for (const [key, value] of Object.entries(aaveData.data)) {
          combinedData[key] = value as AaveTokenRate;
        }
      }
    }

    // Process Spark response - store RAW rates (no discount applied)
    if (sparkResponse?.ok) {
      const sparkData = await sparkResponse.json();
      if (sparkData.success && sparkData.data) {
        for (const [key, value] of Object.entries(sparkData.data)) {
          // Spark returns { apy, conversionRate, timestamp } - normalize to AaveTokenRate
          const sparkRate = value as { apy: number; conversionRate?: string; timestamp: number };
          combinedData[key] = {
            apy: sparkRate.apy,
            utilization: 0, // Spark doesn't return utilization
            timestamp: sparkRate.timestamp,
          };
        }
      }
    }

    const data: AaveRatesResponse = {
      success: Object.keys(combinedData).length > 0,
      source: 'live',
      data: combinedData,
    };

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

    // Return RAW rates - apply pool factor at display time via applyPoolYieldFactorToHistory()
    return await response.json() as AaveHistoryResponse;
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
 * Calculate lending APR for a token pair from rates data.
 * Automatically applies pool-level yield factor.
 * Returns average if both tokens supported, single token's APY if only one supported, null otherwise.
 */
export function getLendingAprForPair(
  ratesData: AaveRatesResponse | undefined,
  token0Symbol: string,
  token1Symbol: string
): number | null {
  if (!ratesData?.success) return null;

  const key0 = getAaveKey(token0Symbol);
  const key1 = getAaveKey(token1Symbol);

  const apy0 = key0 && ratesData.data[key0] ? ratesData.data[key0].apy : null;
  const apy1 = key1 && ratesData.data[key1] ? ratesData.data[key1].apy : null;

  // Calculate raw average
  let rawAvg: number | null = null;
  if (apy0 !== null && apy1 !== null) {
    rawAvg = (apy0 + apy1) / 2;
  } else {
    rawAvg = apy0 ?? apy1 ?? null;
  }

  if (rawAvg === null) return null;
  return applyPoolYieldFactor(rawAvg, token0Symbol, token1Symbol);
}

/**
 * Hook-friendly wrapper that includes loading/error state
 * For use with React Query or SWR
 */
export const aaveRatesQueryKey = ['aave', 'rates'] as const;
export const aaveHistoryQueryKey = (token: string, period: string) =>
  ['aave', 'history', token, period] as const;
