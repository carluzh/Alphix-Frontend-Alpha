'use client';

import React, { createContext, useContext, useCallback, useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useSSE } from './useSSE';
import type {
  SSEConnectionStatus,
  PositionSnapshotPayload,
  PointsPayload,
  YieldPayload,
  AaveYieldPayload,
  ReferralPayload,
} from './types';

// ============================================================================
// Context Types
// ============================================================================

interface SSEContextValue {
  // Connection state
  status: SSEConnectionStatus;
  isConnected: boolean;
  reconnect: () => void;
  disconnect: () => void;

  // Latest data from each channel
  latestSnapshot: PositionSnapshotPayload | null;
  latestPoints: PointsPayload | null;
  latestYield: YieldPayload | null;
  latestAaveYield: AaveYieldPayload | null;
  latestReferral: ReferralPayload | null;

  // Subscribe to specific events (for components that need real-time updates)
  subscribeToSnapshots: (callback: (data: PositionSnapshotPayload) => void) => () => void;
  subscribeToPoints: (callback: (data: PointsPayload) => void) => () => void;
  subscribeToYield: (callback: (data: YieldPayload) => void) => () => void;
  subscribeToAaveYield: (callback: (data: AaveYieldPayload) => void) => () => void;
  subscribeToReferral: (callback: (data: ReferralPayload) => void) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

// ============================================================================
// Subscription Manager Helper
// ============================================================================

function createSubscriptionManager<T>() {
  const subscribers = new Set<(data: T) => void>();

  return {
    subscribe: (callback: (data: T) => void) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    notify: (data: T) => {
      subscribers.forEach((cb) => cb(data));
    },
  };
}

// ============================================================================
// Provider Component
// ============================================================================

interface SSEProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export function SSEProvider({ children, enabled = true }: SSEProviderProps) {
  const { address } = useAccount();

  // Latest data state
  const [latestSnapshot, setLatestSnapshot] = useState<PositionSnapshotPayload | null>(null);
  const [latestPoints, setLatestPoints] = useState<PointsPayload | null>(null);
  const [latestYield, setLatestYield] = useState<YieldPayload | null>(null);
  const [latestAaveYield, setLatestAaveYield] = useState<AaveYieldPayload | null>(null);
  const [latestReferral, setLatestReferral] = useState<ReferralPayload | null>(null);

  // Subscription managers (stable references)
  const [snapshotSubs] = useState(() => createSubscriptionManager<PositionSnapshotPayload>());
  const [pointsSubs] = useState(() => createSubscriptionManager<PointsPayload>());
  const [yieldSubs] = useState(() => createSubscriptionManager<YieldPayload>());
  const [aaveYieldSubs] = useState(() => createSubscriptionManager<AaveYieldPayload>());
  const [referralSubs] = useState(() => createSubscriptionManager<ReferralPayload>());

  // Event handlers
  const handleSnapshot = useCallback((data: PositionSnapshotPayload) => {
    setLatestSnapshot(data);
    snapshotSubs.notify(data);
  }, [snapshotSubs]);

  const handlePoints = useCallback((data: PointsPayload) => {
    setLatestPoints(data);
    pointsSubs.notify(data);
  }, [pointsSubs]);

  const handleYield = useCallback((data: YieldPayload) => {
    setLatestYield(data);
    yieldSubs.notify(data);
  }, [yieldSubs]);

  const handleAaveYield = useCallback((data: AaveYieldPayload) => {
    setLatestAaveYield(data);
    aaveYieldSubs.notify(data);
  }, [aaveYieldSubs]);

  const handleReferral = useCallback((data: ReferralPayload) => {
    setLatestReferral(data);
    referralSubs.notify(data);
  }, [referralSubs]);

  // SSE connection
  const { status, reconnect, disconnect } = useSSE({
    address,
    enabled: enabled && !!address,
    onSnapshot: handleSnapshot,
    onPoints: handlePoints,
    onYield: handleYield,
    onAaveYield: handleAaveYield,
    onReferral: handleReferral,
  });

  // Context value
  const value = useMemo<SSEContextValue>(() => ({
    status,
    isConnected: status === 'connected',
    reconnect,
    disconnect,
    latestSnapshot,
    latestPoints,
    latestYield,
    latestAaveYield,
    latestReferral,
    subscribeToSnapshots: snapshotSubs.subscribe,
    subscribeToPoints: pointsSubs.subscribe,
    subscribeToYield: yieldSubs.subscribe,
    subscribeToAaveYield: aaveYieldSubs.subscribe,
    subscribeToReferral: referralSubs.subscribe,
  }), [
    status,
    reconnect,
    disconnect,
    latestSnapshot,
    latestPoints,
    latestYield,
    latestAaveYield,
    latestReferral,
    snapshotSubs.subscribe,
    pointsSubs.subscribe,
    yieldSubs.subscribe,
    aaveYieldSubs.subscribe,
    referralSubs.subscribe,
  ]);

  return (
    <SSEContext.Provider value={value}>
      {children}
    </SSEContext.Provider>
  );
}

// ============================================================================
// Hook to access context
// ============================================================================

export function useSSEContext() {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSEContext must be used within SSEProvider');
  }
  return context;
}
