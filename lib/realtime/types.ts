/**
 * SSE Realtime Types
 *
 * Modular type definitions for server-sent events.
 * Designed to support multiple data channels:
 * - Position snapshots
 * - Points
 * - Yield for Positions
 * - Aave 4626 Yield
 * - Referrals
 */

// ============================================================================
// Core SSE Types
// ============================================================================

export type SSEConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SSEConfig {
  baseUrl: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

// ============================================================================
// Event Types - Add new event types here as they're implemented
// ============================================================================

export type SSEEventType =
  | 'connected'
  | 'heartbeat'
  | 'snapshot'      // Position snapshots
  | 'points'        // Points updates (future)
  | 'yield'         // Position yield (future)
  | 'aaveYield'     // Aave 4626 yield (future)
  | 'referral';     // Referral updates (future)

// ============================================================================
// Payload Types - One per event type
// ============================================================================

/** Connected event payload */
export interface ConnectedPayload {
  timestamp: number;
  address: string;
}

/** Heartbeat event payload */
export interface HeartbeatPayload {
  timestamp: number;
}

/** Position snapshot payload - matches backend SnapshotPayload */
export interface PositionSnapshotPayload {
  timestamp: number;
  positions: Array<{
    positionId: string;
    poolId: string;
    valueUsd: number;
    amount0: number;
    amount1: number;
  }>;
}

/** Points payload (future) */
export interface PointsPayload {
  timestamp: number;
  totalPoints: number;
  breakdown: Array<{
    category: string;
    points: number;
  }>;
}

/** Yield payload (future) */
export interface YieldPayload {
  timestamp: number;
  positions: Array<{
    positionId: string;
    feesEarnedUsd: number;
    apr: number;
  }>;
}

/** Aave 4626 yield payload (future) */
export interface AaveYieldPayload {
  timestamp: number;
  vaults: Array<{
    vaultAddress: string;
    apy: number;
    earnedUsd: number;
  }>;
}

/** Referral payload (future) */
export interface ReferralPayload {
  timestamp: number;
  totalReferrals: number;
  earnedUsd: number;
}

// ============================================================================
// Event Map - Maps event type to payload type
// ============================================================================

export interface SSEEventMap {
  connected: ConnectedPayload;
  heartbeat: HeartbeatPayload;
  snapshot: PositionSnapshotPayload;
  points: PointsPayload;
  yield: YieldPayload;
  aaveYield: AaveYieldPayload;
  referral: ReferralPayload;
}

// ============================================================================
// Handler Types
// ============================================================================

export type SSEEventHandler<T extends SSEEventType> = (payload: SSEEventMap[T]) => void;

export interface SSEHandlers {
  onConnected?: SSEEventHandler<'connected'>;
  onHeartbeat?: SSEEventHandler<'heartbeat'>;
  onSnapshot?: SSEEventHandler<'snapshot'>;
  onPoints?: SSEEventHandler<'points'>;
  onYield?: SSEEventHandler<'yield'>;
  onAaveYield?: SSEEventHandler<'aaveYield'>;
  onReferral?: SSEEventHandler<'referral'>;
  onError?: (error: Error) => void;
  onStatusChange?: (status: SSEConnectionStatus) => void;
}
