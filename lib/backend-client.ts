// AlphixBackend API client — network-aware via ?network= param.

import { type NetworkMode } from './network-mode';
import { CHAIN_REGISTRY } from './chain-registry';

const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

/** Map frontend NetworkMode to backend network query param */
export function getNetworkParam(networkMode: NetworkMode): string {
  return CHAIN_REGISTRY[networkMode].backendNetwork;
}

export function buildBackendUrl(
  path: string,
  networkMode: NetworkMode,
  params?: Record<string, string>
): string {
  // Handle path starting with or without leading slash
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, BACKEND_URL);
  url.searchParams.set('network', getNetworkParam(networkMode));
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

/**
 * Build a backend URL WITHOUT network param (for base-only endpoints)
 *
 * Used for: /aave/rates, /spark/rates, /points/*, /referral/*
 */
export function buildBackendUrlNoNetwork(
  path: string,
  params?: Record<string, string>
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, BACKEND_URL);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

/**
 * Get the raw backend URL (for SSE connections that build their own params)
 */
export function getBackendUrl(): string {
  return BACKEND_URL;
}

/**
 * Convert position ID to full 66-character hex format expected by backend.
 *
 * Backend expects: 0x00000000000000000000000000000000000000000000000000000000000e054b
 * Frontend may pass: decimal string "913739", short hex "e054b", or partial hex "0xe054b"
 *
 * @param positionId - Position ID in any format (decimal, short hex, or full hex)
 * @returns Full 66-char hex string (0x + 64 hex chars)
 */
function toFullHexPositionId(positionId: string): string {
  // If already 66-char hex, return as-is (lowercase for consistency)
  if (positionId.startsWith('0x') && positionId.length === 66) {
    return positionId.toLowerCase();
  }

  // Convert to BigInt (handles decimal strings and hex formats)
  let value: bigint;
  try {
    if (positionId.startsWith('0x')) {
      value = BigInt(positionId);
    } else if (/^\d+$/.test(positionId)) {
      // Pure decimal string
      value = BigInt(positionId);
    } else {
      // Assume hex without 0x prefix
      value = BigInt('0x' + positionId);
    }
  } catch {
    // If conversion fails, return original (will likely fail at API level)
    console.warn('[toFullHexPositionId] Failed to convert:', positionId);
    return positionId;
  }

  // Convert to 66-char hex (0x + 64 hex chars, zero-padded)
  return '0x' + value.toString(16).padStart(64, '0');
}

/**
 * Chart point from backend
 */
export interface PortfolioChartPoint {
  timestamp: number;
  positionsValue: number;
}

/**
 * Portfolio chart response
 */
export interface PortfolioChartResponse {
  success: boolean;
  address: string;
  period: 'DAY' | 'WEEK' | 'MONTH';
  fromTimestamp: number;
  toTimestamp: number;
  positionCount: number;
  points: PortfolioChartPoint[];
  error?: string;
}

/**
 * Pool snapshot from backend
 */
export interface PoolSnapshot {
  timestamp: number;
  tick: number;
  sqrtPriceX96: string;
  liquidity: string;
  tvlToken0: number;
  tvlToken1: number;
  volumeToken024h?: number;
  tvlUSD?: number;
  volumeUSD?: number;
  feesUSD?: number;
}

/**
 * Pool history response
 */
export interface PoolHistoryResponse {
  success: boolean;
  poolId: string;
  poolName?: string;
  period: string;
  fromTimestamp: number;
  toTimestamp: number;
  snapshotCount: number;
  snapshots: PoolSnapshot[];
  error?: string;
}

/**
 * Fetch portfolio chart data (historical position values)
 *
 * Simple GET endpoint - just pass address and period.
 * Backend returns SUM of stored position values grouped by timestamp.
 * Frontend adds the "live now" point using position data it already has.
 *
 * @param address - User's wallet address
 * @param period - Time period (DAY, WEEK, MONTH)
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPositionsChart(
  address: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'base'
): Promise<PortfolioChartResponse> {
  try {
    const url = buildBackendUrl('/portfolio/chart', networkMode, {
      address: address,
      period: period,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      address,
      period,
      fromTimestamp: 0,
      toTimestamp: 0,
      positionCount: 0,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch pool history (snapshots)
 *
 * @param poolId - Pool ID
 * @param period - Time period (DAY, WEEK, MONTH)
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPoolHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'base'
): Promise<PoolHistoryResponse> {
  try {
    const url = buildBackendUrl(`/pools/${encodeURIComponent(poolId)}/history`, networkMode, {
      period: period,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      poolId,
      period,
      fromTimestamp: 0,
      toTimestamp: 0,
      snapshotCount: 0,
      snapshots: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Position fee chart point
 */
export interface FeeChartPoint {
  timestamp: number;
  feesUsd: number;
  accumulatedFeesUsd: number;
  apr: number;
}

/**
 * Position fee chart response
 */
export interface PositionFeeChartResponse {
  success: boolean;
  positionId: string;
  period: 'DAY' | 'WEEK' | 'MONTH';
  fromTimestamp: number;
  toTimestamp: number;
  points: FeeChartPoint[];
  error?: string;
}

/**
 * Fetch position fee chart data (historical fee values)
 *
 * Simple GET endpoint - just pass positionId and period.
 * Backend returns stored fee snapshots.
 * Frontend adds the "live now" point using data it already has.
 *
 * @param positionId - Position token ID
 * @param period - Time period (1W, 1M, 1Y, ALL - mapped to backend format)
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPositionFees(
  positionId: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W',
  networkMode: NetworkMode = 'base'
): Promise<PositionFeeChartResponse> {
  // Map frontend period format to backend format
  const periodMap: Record<string, 'DAY' | 'WEEK' | 'MONTH'> = {
    '1W': 'WEEK',
    '1M': 'MONTH',
    '1Y': 'MONTH',
    'ALL': 'MONTH',
  };
  const backendPeriod = periodMap[period] || 'WEEK';

  // Convert position ID to full 66-char hex format expected by backend
  const fullHexPositionId = toFullHexPositionId(positionId);

  try {
    const url = buildBackendUrl(`/position/${encodeURIComponent(fullHexPositionId)}/fees`, networkMode, {
      period: backendPeriod,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      positionId: fullHexPositionId,
      period: backendPeriod,
      fromTimestamp: 0,
      toTimestamp: 0,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Position APR response
 */
export interface PositionAprResponse {
  success: boolean;
  positionId: string;
  /** 7d-avg APR as percentage (e.g., 1.826 = 1.826%) */
  apr7d: number | null;
  /** Formatted APR for display (e.g., "1.83%") */
  apr7dPercent: string | null;
  /** Number of snapshots used */
  dataPoints: number;
  /** In-range periods count */
  inRangeDataPoints: number;
  /** Actual coverage in days (may be < 7 for new positions) */
  daysCovered: number;
  /** Most recent snapshot value */
  latestValueUsd: number | null;
  error?: string;
}

/**
 * Fetch position-specific 7-day average APR
 *
 * Uses backend's hourly snapshots to calculate accurate position APR.
 * Returns daysCovered < 7 for positions younger than 7 days.
 *
 * @param positionId - Position token ID
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPositionApr(
  positionId: string,
  networkMode: NetworkMode = 'base'
): Promise<PositionAprResponse> {
  // Convert position ID to full 66-char hex format expected by backend
  const fullHexPositionId = toFullHexPositionId(positionId);

  try {
    const url = buildBackendUrl(`/position/${encodeURIComponent(fullHexPositionId)}/apr`, networkMode);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      positionId: fullHexPositionId,
      apr7d: null,
      apr7dPercent: null,
      dataPoints: 0,
      inRangeDataPoints: 0,
      daysCovered: 0,
      latestValueUsd: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get current pool state
 *
 * @param poolId - Pool ID
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPoolCurrent(
  poolId: string,
  networkMode: NetworkMode = 'base'
): Promise<{
  success: boolean;
  snapshot?: PoolSnapshot;
  error?: string;
}> {
  try {
    const url = buildBackendUrl(`/pools/${encodeURIComponent(poolId)}/current`, networkMode);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      success: true,
      snapshot: data.snapshot,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// UNIFIED YIELD ENDPOINTS
// =============================================================================

/**
 * APR response for a UY pool
 */
export interface UnifiedYieldPoolAprResponse {
  success: boolean;
  network?: string;
  poolName?: string;
  poolId: string;
  swapApr7d: number | null;
  swapApr24h?: number | null;
  volume24hUsd?: number;
  tvlUsd?: number;
  calculatedAt?: number;
  error?: string;
}

/**
 * Fetch swap APR for a Unified Yield pool
 *
 * @param poolId - Pool ID
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchUnifiedYieldPoolApr(
  poolId: string,
  networkMode: NetworkMode = 'base'
): Promise<UnifiedYieldPoolAprResponse> {
  try {
    const url = buildBackendUrl(`/unified-yield/pool/${encodeURIComponent(poolId)}/apr`, networkMode);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      poolId,
      swapApr7d: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Historical APR point from UY pool APR history endpoint.
 * Backend returns `swapApr` (the pool's swap fee APR) and `tvlUsd`.
 */
export interface AprHistoryPoint {
  timestamp: number;
  swapApr: number;
  tvlUsd?: number;
}

/**
 * Historical APR response
 */
export interface UnifiedYieldAprHistoryResponse {
  success: boolean;
  poolId: string;
  period: string;
  points: AprHistoryPoint[];
  error?: string;
}

/**
 * Fetch historical APR for a Unified Yield pool
 *
 * @param poolId - Pool ID
 * @param period - Time period (DAY, WEEK, MONTH)
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchUnifiedYieldPoolAprHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'base'
): Promise<UnifiedYieldAprHistoryResponse> {
  try {
    const url = buildBackendUrl(`/unified-yield/pool/${encodeURIComponent(poolId)}/apr/history`, networkMode, {
      period: period,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      poolId,
      period,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Historical pool prices response
 */
export interface PoolPricesHistoryResponse {
  success: boolean;
  poolId: string;
  period: string;
  points: Array<{
    timestamp: number;
    token0PriceUsd: number;
    token1PriceUsd: number;
    tick?: number;
  }>;
  error?: string;
}

/**
 * Fetch historical token prices from a pool
 *
 * @param poolId - Pool ID
 * @param period - Time period (DAY, WEEK, MONTH)
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPoolPricesHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'base'
): Promise<PoolPricesHistoryResponse> {
  try {
    const url = buildBackendUrl(`/pools/${encodeURIComponent(poolId)}/prices/history`, networkMode, {
      period: period,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      poolId,
      period,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// SPARK RATES (MAINNET-ONLY)
// =============================================================================

/**
 * Spark rate data (sUSDS yield)
 */
interface SparkRateData {
  apy: number;
  timestamp: number;
}

/**
 * Spark rates response
 */
interface SparkRatesResponse {
  success: boolean;
  data: SparkRateData | null;
  error?: string;
}

/**
 * Spark historical rate point
 */
interface SparkHistoryPoint {
  timestamp: number;
  apy: number;
}

/**
 * Spark rates history response
 */
interface SparkHistoryResponse {
  success: boolean;
  token: string;
  period: string;
  points: SparkHistoryPoint[];
  error?: string;
}

/**
 * Fetch historical Spark rates for a token
 *
 * Note: This is Base-only - no network param needed
 *
 * @param token - Token symbol (e.g., 'DAI', 'USDS')
 * @param period - Time period (DAY, WEEK, MONTH)
 */
export async function fetchSparkRatesHistory(
  token: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK'
): Promise<SparkHistoryResponse> {
  try {
    const url = new URL('/spark/rates/history', BACKEND_URL);
    url.searchParams.set('token', token);
    url.searchParams.set('period', period);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    // Return RAW rates - pool factor applied at display time via applyPoolYieldFactor()
    return await response.json() as SparkHistoryResponse;
  } catch (error) {
    return {
      success: false,
      token,
      period,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// UNIFIED YIELD COMPOUNDED FEES
// =============================================================================

/**
 * Compounded fees response for a Unified Yield position
 */
export interface UnifiedYieldCompoundedFeesResponse {
  success: boolean;
  network?: string;
  positionId: string;
  hookAddress?: string;
  poolId?: string;
  poolName?: string;
  /** Estimated lifetime yield (swap fees + lending) */
  compoundedFeesUSD: number;
  /** Total deposits minus withdrawals */
  netDepositUSD?: number;
  /** Latest snapshot value */
  currentValueUSD?: number;
  /** Unix timestamp of first deposit */
  createdAtTimestamp?: number;
  /** Calculation method used */
  calculationMethod?: string;
  error?: string;
}

/**
 * Fetch compounded fees for a Unified Yield position
 *
 * Position ID format: "{hookAddress}-{userAddress}"
 *
 * @param hookAddress - Hook contract address
 * @param userAddress - User wallet address
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchUnifiedYieldPositionCompoundedFees(
  hookAddress: string,
  userAddress: string,
  networkMode: NetworkMode = 'base'
): Promise<UnifiedYieldCompoundedFeesResponse> {
  const positionId = `${hookAddress.toLowerCase()}-${userAddress.toLowerCase()}`;

  try {
    const url = buildBackendUrl(
      `/unified-yield/position/${encodeURIComponent(positionId)}/compounded-fees`,
      networkMode
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      positionId,
      compoundedFeesUSD: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the WebSocket URL based on environment and network mode
 *
 * Returns:
 * - Development: ws://34.60.82.34:3001/ws?network=base|arbitrum
 * - Production: wss://api.alphix.fi/ws?network=base|arbitrum
 *
 * @param networkMode - Optional network mode ('base' | 'arbitrum'). If not provided, returns base URL without network param.
 */
export function getWebSocketUrl(networkMode?: NetworkMode): string {
  let baseUrl: string;

  const wsUrl = process.env.NEXT_PUBLIC_ALPHIX_WS_URL;
  if (wsUrl) {
    baseUrl = wsUrl;
  } else if (typeof window !== 'undefined') {
    if (window.location.hostname === 'localhost') {
      baseUrl = 'ws://34.60.82.34:3001/ws';
    } else {
      // Production - use secure WebSocket
      baseUrl = 'wss://api.alphix.fi/ws';
    }
  } else {
    // Server-side default
    baseUrl = 'ws://34.60.82.34:3001/ws';
  }

  if (networkMode) {
    return `${baseUrl}?network=${getNetworkParam(networkMode)}`;
  }

  return baseUrl;
}

// =============================================================================
// POOL METRICS (Initial load for WebSocket)
// =============================================================================

/**
 * Pool metrics data (matches WebSocket pools:metrics format)
 */
export interface PoolMetrics {
  poolId: string;
  name: string;
  network: string;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  /** 24h lending yield in USD (from Aave/Spark for UY pools) */
  lendingYield24hUsd?: number;
  /** 24h total fees in USD (swap fees + lending yield) */
  totalFees24hUsd?: number;
  lpFee: number;
  /** USD value of token0 reserves (CL + UY combined) */
  tvlToken0Usd?: number;
  /** USD value of token1 reserves (CL + UY combined) */
  tvlToken1Usd?: number;
  /** Total lifetime fees earned by LPs in this pool */
  cumulativeFeesUsd?: number;
  token0Price: number;
  token1Price: number;
  /** Swap APY — compound daily: ((1 + fees24h/tvl)^365 - 1) * 100 */
  swapApy?: number;
  /** Lending APY — weighted by rehypothecated amounts, with yield factor applied */
  lendingApy?: number;
  /** Total APY — swapApy + lendingApy */
  totalApy?: number;
  /** Annualized realized volatility (%) — from LVRFee Blackbox engine */
  volatility?: number | null;
  /** LLM agent fee adjustment in bps — from LVRFee Blackbox engine */
  agentAdjustment?: number | null;
  /** Lifetime extra LP earnings from dynamic fee vs static base fee (USD) */
  lvrSavedUsd?: number | null;
  timestamp: number;
}

/**
 * Response for fetching all pool metrics
 */
export interface PoolsMetricsResponse {
  success: boolean;
  network: string;
  pools: PoolMetrics[];
  timestamp: number;
  error?: string;
}

/**
 * Fetch all pool metrics from backend
 *
 * Used for initial load before WebSocket updates.
 * Returns the same data structure as WebSocket pools:metrics channel.
 *
 * @param networkMode - Network mode ('base' | 'arbitrum')
 */
export async function fetchPoolsMetrics(
  networkMode: NetworkMode = 'base'
): Promise<PoolsMetricsResponse> {
  try {
    const url = buildBackendUrl('/pools/metrics', networkMode);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      network: getNetworkParam(networkMode),
      pools: [],
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** Fetch pool metrics for ALL chains in one request (no ?network= param). */
export async function fetchAllPoolsMetrics(): Promise<PoolsMetricsResponse> {
  try {
    const url = buildBackendUrlNoNetwork('/pools/metrics');
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    return { success: false, network: 'all', pools: [], timestamp: Date.now(), error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

