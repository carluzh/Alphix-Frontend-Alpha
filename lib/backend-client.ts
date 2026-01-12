/**
 * AlphixBackend Client
 *
 * Client for calling the AlphixBackend API for portfolio chart data.
 * The backend handles pool snapshots, position value calculations, and fee estimation.
 */

// Backend URL - defaults to localhost for development
const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

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
 */
export async function fetchPositionsChart(
  address: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK'
): Promise<PortfolioChartResponse> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/portfolio/chart?address=${encodeURIComponent(address)}&period=${period}`,
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
 */
export async function fetchPoolHistory(
  poolId: string,
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK'
): Promise<PoolHistoryResponse> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/pools/${encodeURIComponent(poolId)}/history?period=${period}`,
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
 */
export async function fetchPositionFees(
  positionId: string,
  period: '1W' | '1M' | '1Y' | 'ALL' = '1W'
): Promise<PositionFeeChartResponse> {
  // Map frontend period format to backend format
  const periodMap: Record<string, string> = {
    '1W': 'WEEK',
    '1M': 'MONTH',
    '1Y': 'YEAR',
    'ALL': 'ALL',
  };
  const backendPeriod = periodMap[period] || 'WEEK';

  try {
    const response = await fetch(
      `${BACKEND_URL}/position/${encodeURIComponent(positionId)}/fees?period=${backendPeriod}`,
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
      positionId,
      period: backendPeriod,
      fromTimestamp: 0,
      toTimestamp: 0,
      points: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get current pool state
 *
 * @param poolId - Pool ID
 */
export async function fetchPoolCurrent(poolId: string): Promise<{
  success: boolean;
  snapshot?: PoolSnapshot;
  error?: string;
}> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/pools/${encodeURIComponent(poolId)}/current`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

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
