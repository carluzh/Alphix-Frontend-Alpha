'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { SSEConnectionStatus, SSEEventType, SSEEventMap, SSEHandlers } from './types';

const BACKEND_URL = process.env.NEXT_PUBLIC_ALPHIX_BACKEND_URL || 'http://localhost:3001';
const DEFAULT_RECONNECT_INTERVAL = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface UseSSEOptions extends SSEHandlers {
  address: string | undefined;
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseSSEReturn {
  status: SSEConnectionStatus;
  reconnect: () => void;
  disconnect: () => void;
}

/**
 * Core SSE hook for managing EventSource connection
 *
 * Handles connection lifecycle, reconnection, and event routing.
 * Used internally by specific hooks (usePositionSnapshots, usePoints, etc.)
 */
export function useSSE({
  address,
  enabled = true,
  reconnectInterval = DEFAULT_RECONNECT_INTERVAL,
  maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
  onConnected,
  onHeartbeat,
  onSnapshot,
  onPoints,
  onYield,
  onAaveYield,
  onReferral,
  onError,
  onStatusChange,
}: UseSSEOptions): UseSSEReturn {
  const [status, setStatus] = useState<SSEConnectionStatus>('disconnected');
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update status and notify
  const updateStatus = useCallback((newStatus: SSEConnectionStatus) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // Parse and route events
  const handleEvent = useCallback(<T extends SSEEventType>(
    eventType: T,
    handler: ((payload: SSEEventMap[T]) => void) | undefined,
    event: MessageEvent
  ) => {
    if (!handler) return;
    try {
      const payload = JSON.parse(event.data) as SSEEventMap[T];
      handler(payload);
    } catch (err) {
      console.error(`[SSE] Failed to parse ${eventType} event:`, err);
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    reconnectAttempts.current = 0;
    updateStatus('disconnected');
  }, [updateStatus]);

  // Connect
  const connect = useCallback(() => {
    if (!address || !enabled) {
      disconnect();
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    updateStatus('connecting');

    const url = `${BACKEND_URL}/stream?address=${encodeURIComponent(address)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Connection opened
    eventSource.onopen = () => {
      reconnectAttempts.current = 0;
      updateStatus('connected');
      console.log('[SSE] Connected');
    };

    // Connection error
    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err);
      updateStatus('error');

      eventSource.close();
      eventSourceRef.current = null;

      // Attempt reconnection
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++;
        console.log(`[SSE] Reconnecting (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})...`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      } else {
        console.error('[SSE] Max reconnection attempts reached');
        onError?.(new Error('Max reconnection attempts reached'));
      }
    };

    // Event handlers
    eventSource.addEventListener('connected', (e) => {
      handleEvent('connected', onConnected, e as MessageEvent);
    });

    eventSource.addEventListener('heartbeat', (e) => {
      handleEvent('heartbeat', onHeartbeat, e as MessageEvent);
    });

    eventSource.addEventListener('snapshot', (e) => {
      handleEvent('snapshot', onSnapshot, e as MessageEvent);
    });

    eventSource.addEventListener('points', (e) => {
      handleEvent('points', onPoints, e as MessageEvent);
    });

    eventSource.addEventListener('yield', (e) => {
      handleEvent('yield', onYield, e as MessageEvent);
    });

    eventSource.addEventListener('aaveYield', (e) => {
      handleEvent('aaveYield', onAaveYield, e as MessageEvent);
    });

    eventSource.addEventListener('referral', (e) => {
      handleEvent('referral', onReferral, e as MessageEvent);
    });
  }, [
    address,
    enabled,
    maxReconnectAttempts,
    reconnectInterval,
    handleEvent,
    disconnect,
    updateStatus,
    onConnected,
    onHeartbeat,
    onSnapshot,
    onPoints,
    onYield,
    onAaveYield,
    onReferral,
    onError,
  ]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  // Connect on mount / address change
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    status,
    reconnect,
    disconnect,
  };
}
