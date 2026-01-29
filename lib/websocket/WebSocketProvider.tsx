'use client';

/**
 * WebSocket Provider
 *
 * React context provider for WebSocket connection management.
 * Auto-subscribes to pools:metrics channel for real-time pool data.
 *
 * Usage:
 * ```tsx
 * // In AppProviders.tsx
 * import { WebSocketProvider } from '@/lib/websocket';
 *
 * function AppProviders({ children }) {
 *   return (
 *     <WebSocketProvider>
 *       {children}
 *     </WebSocketProvider>
 *   );
 * }
 *
 * // In a component
 * function PoolStats({ poolId }) {
 *   const { pools, isConnected } = useWebSocket();
 *   const pool = pools.get(poolId);
 *   // ...
 * }
 * ```
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { WebSocketManager } from './WebSocketManager';
import { useNetwork } from '../network-context';
import type {
  WSConnectionState,
  WSPoolData,
  WSConfig,
  WSServerMessage,
} from './types';
import { isPoolData } from './types';

// Channel name for pool metrics
const POOLS_METRICS_CHANNEL = 'pools:metrics';

// =============================================================================
// CONTEXT TYPES
// =============================================================================

interface WebSocketContextValue {
  // Connection state
  state: WSConnectionState;
  isConnected: boolean;
  reconnectAttempts: number;

  // Connection control
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;

  // Data stores (latest values from pools:metrics channel)
  pools: Map<string, WSPoolData>;

  // Event subscriptions (for components that want real-time callbacks)
  onPoolUpdate: (callback: (data: WSPoolData) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

// =============================================================================
// SUBSCRIPTION MANAGER
// =============================================================================

function createSubscriptionManager<T>() {
  const subscribers = new Set<(data: T) => void>();

  return {
    subscribe: (callback: (data: T) => void) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    notify: (data: T) => {
      subscribers.forEach((cb) => {
        try {
          cb(data);
        } catch (error) {
          console.error('[WS] Subscriber error:', error);
        }
      });
    },
    size: () => subscribers.size,
  };
}

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

interface WebSocketProviderProps {
  children: React.ReactNode;
  /** Whether to auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Custom WebSocket configuration */
  config?: WSConfig;
}

export function WebSocketProvider({
  children,
  autoConnect = true,
  config,
}: WebSocketProviderProps) {
  const { networkMode } = useNetwork();

  // Connection state
  const [state, setState] = useState<WSConnectionState>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Data stores
  const [pools, setPools] = useState<Map<string, WSPoolData>>(new Map());

  // Subscription managers
  const poolSubsRef = useRef(createSubscriptionManager<WSPoolData>());

  // WebSocket manager ref
  const wsManagerRef = useRef<WebSocketManager | null>(null);

  // Handle pool metrics message (can be array or single object)
  const handlePoolMetricsMessage = useCallback((message: WSServerMessage) => {
    if (message.type !== 'data' || message.channel !== POOLS_METRICS_CHANNEL) {
      return;
    }

    const data = message.data;

    // Initial message: array of all pools
    if (Array.isArray(data)) {
      console.log(`[WS] Received initial pool metrics: ${data.length} pools`);
      setPools((prev) => {
        const next = new Map(prev);
        for (const pool of data) {
          if (pool && typeof pool === 'object' && 'poolId' in pool) {
            const poolData = pool as WSPoolData;
            next.set(poolData.poolId.toLowerCase(), poolData);
            poolSubsRef.current.notify(poolData);
          }
        }
        return next;
      });
      return;
    }

    // Update message: single pool object
    if (isPoolData(data)) {
      const poolData = data as WSPoolData;
      setPools((prev) => {
        const next = new Map(prev);
        next.set(poolData.poolId.toLowerCase(), poolData);
        return next;
      });
      poolSubsRef.current.notify(poolData);
    }
  }, []);

  // Initialize WebSocket manager (only once on mount)
  useEffect(() => {
    const manager = new WebSocketManager(
      {
        onConnect: () => {
          setState('connected');
          setReconnectAttempts(0);
          // Auto-subscribe to pools:metrics channel on connect
          console.log('[WS] Connected, subscribing to pools:metrics');
          manager.subscribe(POOLS_METRICS_CHANNEL);
        },
        onDisconnect: () => {
          setState('disconnected');
        },
        onReconnecting: (attempt) => {
          setState('reconnecting');
          setReconnectAttempts(attempt);
        },
        onError: (error) => {
          console.error('[WS Provider] Error:', error);
        },
        onMessage: handlePoolMetricsMessage,
      },
      config,
      networkMode // Pass initial network mode
    );

    wsManagerRef.current = manager;

    // Auto-connect if enabled
    if (autoConnect) {
      manager.connect();
    }

    // Cleanup on unmount
    return () => {
      manager.disconnect();
      wsManagerRef.current = null;
    };
    // Only run on mount - network changes handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, config, handlePoolMetricsMessage]);

  // Handle network mode changes - switch WebSocket connection
  useEffect(() => {
    if (wsManagerRef.current) {
      // Clear pool data for new network
      setPools(new Map());
      // Switch to new network (reconnects with ?network= param)
      wsManagerRef.current.switchNetwork(networkMode);
    }
  }, [networkMode]);

  // ===========================================================================
  // Context Methods
  // ===========================================================================

  const connect = useCallback(() => {
    wsManagerRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsManagerRef.current?.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    wsManagerRef.current?.reconnect();
  }, []);

  const onPoolUpdate = useCallback((callback: (data: WSPoolData) => void) => {
    return poolSubsRef.current.subscribe(callback);
  }, []);

  // ===========================================================================
  // Context Value
  // ===========================================================================

  const value = useMemo<WebSocketContextValue>(
    () => ({
      // Connection state
      state,
      isConnected: state === 'connected',
      reconnectAttempts,

      // Connection control
      connect,
      disconnect,
      reconnect,

      // Data stores
      pools,

      // Event subscriptions
      onPoolUpdate,
    }),
    [
      state,
      reconnectAttempts,
      connect,
      disconnect,
      reconnect,
      pools,
      onPoolUpdate,
    ]
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to access WebSocket context
 *
 * @throws Error if used outside WebSocketProvider
 */
export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return context;
}

/**
 * Hook to access WebSocket context with optional fallback
 *
 * Returns null if used outside WebSocketProvider (doesn't throw)
 */
export function useWebSocketOptional(): WebSocketContextValue | null {
  return useContext(WebSocketContext);
}
