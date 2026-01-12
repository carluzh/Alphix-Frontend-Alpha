'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useSSEContext } from '../SSEProvider';
import type { PositionSnapshotPayload } from '../types';

interface PositionSnapshot {
  positionId: string;
  poolId: string;
  valueUsd: number;
  amount0: number;
  amount1: number;
}

interface UsePositionSnapshotsOptions {
  /** Filter to specific position IDs */
  positionIds?: string[];
  /** Filter to specific pool ID */
  poolId?: string;
  /** Max number of historical snapshots to keep per position */
  maxHistory?: number;
}

interface UsePositionSnapshotsReturn {
  /** Whether SSE is connected */
  isConnected: boolean;
  /** Latest snapshot data (all positions) */
  latestSnapshot: PositionSnapshotPayload | null;
  /** Latest positions from the most recent snapshot */
  latestPositions: PositionSnapshot[];
  /** Get historical snapshots for a specific position */
  getPositionHistory: (positionId: string) => Array<{ timestamp: number; valueUsd: number }>;
  /** Total value of all positions in latest snapshot */
  totalValueUsd: number;
}

/**
 * Hook for consuming position snapshot data from SSE
 *
 * Use this hook in components that display position charts or values.
 * Data is automatically updated when the server pushes new snapshots.
 */
export function usePositionSnapshots(options: UsePositionSnapshotsOptions = {}): UsePositionSnapshotsReturn {
  const { positionIds, poolId, maxHistory = 100 } = options;
  const { isConnected, latestSnapshot, subscribeToSnapshots } = useSSEContext();

  // History storage: positionId -> array of { timestamp, valueUsd }
  const historyRef = useRef<Map<string, Array<{ timestamp: number; valueUsd: number }>>>(new Map());
  const [, forceUpdate] = useState({});

  // Process new snapshot and update history
  const processSnapshot = useCallback((data: PositionSnapshotPayload) => {
    const history = historyRef.current;

    for (const position of data.positions) {
      // Apply filters
      if (positionIds && !positionIds.includes(position.positionId)) continue;
      if (poolId && position.poolId !== poolId) continue;

      // Get or create history array
      let positionHistory = history.get(position.positionId);
      if (!positionHistory) {
        positionHistory = [];
        history.set(position.positionId, positionHistory);
      }

      // Add new data point (avoid duplicates)
      const lastEntry = positionHistory[positionHistory.length - 1];
      if (!lastEntry || lastEntry.timestamp !== data.timestamp) {
        positionHistory.push({
          timestamp: data.timestamp,
          valueUsd: position.valueUsd,
        });

        // Trim to max history
        if (positionHistory.length > maxHistory) {
          positionHistory.shift();
        }
      }
    }

    // Trigger re-render
    forceUpdate({});
  }, [positionIds, poolId, maxHistory]);

  // Subscribe to snapshots
  useEffect(() => {
    const unsubscribe = subscribeToSnapshots(processSnapshot);
    return unsubscribe;
  }, [subscribeToSnapshots, processSnapshot]);

  // Filter latest positions
  const latestPositions = latestSnapshot?.positions.filter((p) => {
    if (positionIds && !positionIds.includes(p.positionId)) return false;
    if (poolId && p.poolId !== poolId) return false;
    return true;
  }) ?? [];

  // Calculate total value
  const totalValueUsd = latestPositions.reduce((sum, p) => sum + p.valueUsd, 0);

  // Get history for a specific position
  const getPositionHistory = useCallback((positionId: string) => {
    return historyRef.current.get(positionId) ?? [];
  }, []);

  return {
    isConnected,
    latestSnapshot,
    latestPositions,
    getPositionHistory,
    totalValueUsd,
  };
}
