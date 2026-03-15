/**
 * Unified Yield Rates Client
 * Fetches lending rates from Aave/Spark via AlphixBackend.
 * Pool-level yield factors configured in POOL_YIELD_FACTORS.
 *
 * Network-aware: pass networkMode to fetch rates from the correct chain's
 * Aave deployment (Base vs Arbitrum). Spark is Base-only.
 */

import type { NetworkMode } from './network-mode';
import { getNetworkParam } from './backend-client';

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
  // Aave tokens (Base + Arbitrum)
  'USDC': { key: 'USDC', protocol: 'aave' },
  'USDT': { key: 'USDT', protocol: 'aave' },
  'WETH': { key: 'WETH', protocol: 'aave' },
  'ETH': { key: 'WETH', protocol: 'aave' },
  'GHO': { key: 'GHO', protocol: 'aave' },
  // Spark tokens (Base only — Spark has no Arbitrum deployment)
  'DAI': { key: 'DAI', protocol: 'spark' },
  'USDS': { key: 'USDS', protocol: 'spark' },
};

/**
 * Single token rate data
 */
interface AaveTokenRate {
  apy: number;
  utilization: number;
  timestamp: number;
}

/**
 * Current rates response
 */
interface AaveRatesResponse {
  success: boolean;
  source?: 'cached' | 'live';
  data: Record<string, AaveTokenRate>;
  error?: string;
}

/**
 * Historical rate point
 */
interface AaveHistoryPoint {
  timestamp: number;
  apy: number;
  utilization: number;
}

/**
 * Historical rates response
 */
interface AaveHistoryResponse {
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

// Per-network in-memory cache for current rates (5 minute TTL)
const ratesCacheMap = new Map<string, { data: AaveRatesResponse; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(networkMode?: NetworkMode): string {
  return networkMode ?? 'default';
}

/**
 * Fetch current rates from Aave (and Spark on Base)
 * Combines rates into a unified response.
 * Uses per-network in-memory cache to avoid excessive API calls.
 *
 * @param networkMode - Optional network. 'arbitrum' fetches Arbitrum Aave rates,
 *                      'base'/undefined fetches Base Aave + Spark rates.
 */
export async function fetchAaveRates(networkMode?: NetworkMode): Promise<AaveRatesResponse> {
  const cacheKey = getCacheKey(networkMode);
  const cached = ratesCacheMap.get(cacheKey);

  // Check cache first
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // Build Aave URL with network param when specified
    const aaveUrl = networkMode
      ? `${BACKEND_URL}/aave/rates?network=${getNetworkParam(networkMode)}`
      : `${BACKEND_URL}/aave/rates`;

    // Spark is Base-only — skip for Arbitrum
    const fetchSpark = networkMode !== 'arbitrum';

    const fetches: Promise<Response | null>[] = [
      fetch(aaveUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null),
    ];

    if (fetchSpark) {
      fetches.push(
        fetch(`${BACKEND_URL}/spark/rates`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null)
      );
    }

    const [aaveResponse, sparkResponse] = await Promise.all(fetches);

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

    // Update per-network cache
    ratesCacheMap.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    // Return cached data if available, even if stale
    if (cached) {
      console.warn('[fetchAaveRates] API failed, using stale cache:', error);
      return cached.data;
    }

    return {
      success: false,
      data: {},
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch historical Aave rates for a token
 *
 * @param tokenSymbol - Token symbol
 * @param period - Time period
 * @param networkMode - Optional network for chain-specific Aave rates
 */
export async function fetchAaveHistory(
  tokenSymbol: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W',
  networkMode?: NetworkMode
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
    let historyUrl = `${BACKEND_URL}/aave/rates/history?token=${encodeURIComponent(aaveKey)}&period=${backendPeriod}`;
    if (networkMode) {
      historyUrl += `&network=${getNetworkParam(networkMode)}`;
    }

    const response = await fetch(historyUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

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
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W',
  networkMode?: NetworkMode
): Promise<{
  success: boolean;
  points: Array<{ timestamp: number; apy: number }>;
  error?: string;
}> {
  const key0 = getAaveKey(token0Symbol);
  const key1 = getAaveKey(token1Symbol);

  // Fetch both in parallel
  const [history0, history1] = await Promise.all([
    key0 ? fetchAaveHistory(token0Symbol, period, networkMode) : Promise.resolve(null),
    key1 ? fetchAaveHistory(token1Symbol, period, networkMode) : Promise.resolve(null),
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
 * Per-source lending APR breakdown for a token pair.
 * Groups tokens by their yield source (aave vs spark) and returns the average APR per source.
 * Applies pool-level yield factor to each source's average.
 *
 * Example: USDS/USDC → { spark: sparkApy(USDS), aave: aaveApy(USDC) }
 * Example: WETH/USDC → { aave: avg(aaveApy(WETH), aaveApy(USDC)) }
 */
export function getLendingAprBySource(
  ratesData: AaveRatesResponse | undefined,
  token0Symbol: string,
  token1Symbol: string
): Record<'aave' | 'spark', number> {
  const result: Record<'aave' | 'spark', number> = { aave: 0, spark: 0 };
  if (!ratesData?.success) return result;

  const tokens = [token0Symbol, token1Symbol];
  const bySource: Record<string, number[]> = {};

  for (const sym of tokens) {
    const mapping = getTokenProtocol(sym);
    if (!mapping) continue;
    const rate = ratesData.data[mapping.key];
    if (!rate) continue;
    if (!bySource[mapping.protocol]) bySource[mapping.protocol] = [];
    bySource[mapping.protocol].push(rate.apy);
  }

  for (const [source, apys] of Object.entries(bySource)) {
    const avg = apys.reduce((a, b) => a + b, 0) / apys.length;
    result[source as 'aave' | 'spark'] = applyPoolYieldFactor(avg, token0Symbol, token1Symbol);
  }

  return result;
}

/**
 * Hook-friendly wrapper that includes loading/error state
 * For use with React Query or SWR
 */
export const aaveRatesQueryKey = (networkMode?: NetworkMode) =>
  ['aave', 'rates', networkMode ?? 'default'] as const;
