/**
 * AlphixBackend Client
 *
 * Client for calling the AlphixBackend API for portfolio chart data.
 * The backend handles pool snapshots, position value calculations, and fee estimation.
 */

// Backend URL - defaults to localhost for development
const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';

/**
 * Position data for portfolio chart calculation
 */
export interface PositionInput {
  positionId: string;
  poolId: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
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
 * Fetch portfolio chart data for positions
 *
 * @param address - User's wallet address
 * @param positions - User's LP positions
 * @param period - Time period (DAY, WEEK, MONTH)
 */
export async function fetchPositionsChart(
  address: string,
  positions: PositionInput[],
  period: 'DAY' | 'WEEK' | 'MONTH' = 'WEEK'
): Promise<PortfolioChartResponse> {
  try {
    const response = await fetch(`${BACKEND_URL}/portfolio/chart?period=${period}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address,
        positions,
      }),
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
