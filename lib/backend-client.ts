/**
 * AlphixBackend Client
 *
 * Client for calling the AlphixBackend API for portfolio chart data.
 * The backend handles pool snapshots, position value calculations, and fee estimation.
 *
 * Network-aware: Most endpoints support ?network=base (mainnet) or ?network=base-sepolia (testnet)
 */

import { type NetworkMode } from './network-mode';

// Backend URL - defaults to localhost for development
const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

// =============================================================================
// NETWORK HELPERS
// =============================================================================

/**
 * Map frontend NetworkMode to backend network query param value
 *
 * @param networkMode - 'mainnet' | 'testnet' from NetworkContext
 * @returns 'base' for mainnet, 'base-sepolia' for testnet
 */
export function getNetworkParam(networkMode: NetworkMode): 'base' | 'base-sepolia' {
  return networkMode === 'testnet' ? 'base-sepolia' : 'base';
}

/**
 * Build a backend URL with network param and optional additional params
 *
 * @param path - API path (e.g., '/pools/0x123/history')
 * @param networkMode - Network mode from context
 * @param params - Additional query params
 * @returns Full URL string
 */
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
 * Build a backend URL WITHOUT network param (for mainnet-only endpoints)
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
 * Backend health status
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  database: 'connected' | 'disconnected';
  error?: string;
}

/**
 * Check backend health
 */
export async function checkBackendHealth(): Promise<HealthStatus> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    return await response.json();
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: 'unknown',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPositionsChart(
  address: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'mainnet'
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPoolHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'mainnet'
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPositionFees(
  positionId: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W',
  networkMode: NetworkMode = 'mainnet'
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPositionApr(
  positionId: string,
  networkMode: NetworkMode = 'mainnet'
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPoolCurrent(
  poolId: string,
  networkMode: NetworkMode = 'mainnet'
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
 * Unified Yield pool info
 */
export interface UnifiedYieldPool {
  poolId: string;
  name: string;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  hookAddress: string;
  tvlUsd?: number;
}

/**
 * Response for listing UY pools
 */
export interface UnifiedYieldPoolsResponse {
  success: boolean;
  pools: UnifiedYieldPool[];
  error?: string;
}

/**
 * Fetch all Unified Yield pools for a network
 *
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchUnifiedYieldPools(
  networkMode: NetworkMode = 'mainnet'
): Promise<UnifiedYieldPoolsResponse> {
  try {
    const url = buildBackendUrl('/unified-yield/pools', networkMode);

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
      pools: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchUnifiedYieldPoolApr(
  poolId: string,
  networkMode: NetworkMode = 'mainnet'
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchUnifiedYieldPoolAprHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'mainnet'
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
 * Token prices from pool
 */
export interface PoolPricesResponse {
  success: boolean;
  poolId: string;
  token0Price: number | null;
  token1Price: number | null;
  error?: string;
}

/**
 * Fetch token prices from a pool
 *
 * @param poolId - Pool ID
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPoolPrices(
  poolId: string,
  networkMode: NetworkMode = 'mainnet'
): Promise<PoolPricesResponse> {
  try {
    const url = buildBackendUrl(`/pools/${encodeURIComponent(poolId)}/prices`, networkMode);

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
      token0Price: null,
      token1Price: null,
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPoolPricesHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK',
  networkMode: NetworkMode = 'mainnet'
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
export interface SparkRateData {
  apy: number;
  timestamp: number;
}

/**
 * Spark rates response
 */
export interface SparkRatesResponse {
  success: boolean;
  data: SparkRateData | null;
  error?: string;
}

/**
 * Fetch Spark rates (sUSDS yield on Ethereum mainnet)
 *
 * Note: This is mainnet-only - no network param needed
 */
export async function fetchSparkRates(): Promise<SparkRatesResponse> {
  try {
    const url = buildBackendUrlNoNetwork('/spark/rates');

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
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Spark historical rate point
 */
export interface SparkHistoryPoint {
  timestamp: number;
  apy: number;
}

/**
 * Spark rates history response
 */
export interface SparkHistoryResponse {
  success: boolean;
  token: string;
  period: string;
  points: SparkHistoryPoint[];
  error?: string;
}

/**
 * Fetch historical Spark rates for a token
 *
 * Note: This is mainnet-only - no network param needed
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

    return await response.json();
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchUnifiedYieldPositionCompoundedFees(
  hookAddress: string,
  userAddress: string,
  networkMode: NetworkMode = 'mainnet'
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

// =============================================================================
// WEBSOCKET REST ENDPOINTS (Initial Load)
// =============================================================================
// These endpoints are used for initial data load before WebSocket updates.
// Pattern: Fetch initial data via REST, then apply WebSocket updates on top.

/**
 * User positions with compounded fees (for WebSocket initial load)
 */
export interface UserPositionsWithFeesResponse {
  success: boolean;
  network: string;
  address: string;
  positions: Array<{
    positionId: string;
    hookAddress: string;
    poolId: string;
    poolName?: string;
    compoundedFeesUSD: number;
    netDepositUSD: number;
    currentValueUSD: number;
    createdAtTimestamp: number;
    calculationMethod?: string;
  }>;
  totals: {
    compoundedFeesUSD: number;
    netDepositUSD: number;
    currentValueUSD: number;
  };
  error?: string;
}

/**
 * Fetch all positions for a user with compounded fees
 *
 * Used for WebSocket initial load - fetches all positions at once.
 *
 * @param address - User's wallet address
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchUserPositionsWithFees(
  address: string,
  networkMode: NetworkMode = 'mainnet'
): Promise<UserPositionsWithFeesResponse> {
  try {
    const url = buildBackendUrl(
      `/unified-yield/user/${encodeURIComponent(address)}/compounded-fees`,
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
      network: getNetworkParam(networkMode),
      address,
      positions: [],
      totals: {
        compoundedFeesUSD: 0,
        netDepositUSD: 0,
        currentValueUSD: 0,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * WebSocket connection stats response
 */
export interface WSStatsResponse {
  success: boolean;
  connectedClients: number;
  totalSubscriptions: number;
  channels: Record<string, number>;
  uptime: number;
  error?: string;
}

/**
 * Get WebSocket server stats (for debugging/monitoring)
 */
export async function fetchWSStats(): Promise<WSStatsResponse> {
  try {
    const url = `${getBackendUrl()}/ws/stats`;

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
      connectedClients: 0,
      totalSubscriptions: 0,
      channels: {},
      uptime: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the WebSocket URL based on environment and network mode
 *
 * Returns:
 * - Development: ws://34.60.82.34:3001/ws?network=base|base-sepolia
 * - Production: wss://api.alphix.fi/ws?network=base|base-sepolia
 *
 * @param networkMode - Optional network mode ('mainnet' | 'testnet'). If not provided, returns base URL without network param.
 */
export function getWebSocketUrl(networkMode?: 'mainnet' | 'testnet'): string {
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

  // Append network param if provided
  if (networkMode) {
    const networkParam = networkMode === 'mainnet' ? 'base' : 'base-sepolia';
    return `${baseUrl}?network=${networkParam}`;
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
  lpFee: number;
  token0Price: number;
  token1Price: number;
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
 * @param networkMode - Network mode ('mainnet' | 'testnet')
 */
export async function fetchPoolsMetrics(
  networkMode: NetworkMode = 'mainnet'
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

